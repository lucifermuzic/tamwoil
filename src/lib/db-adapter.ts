
import { supabase } from './supabase';

// Helper to handle increment/arrayUnion logic locally before sending to Supabase
// Since we are moving from NoSQL-style JSON to Postgres, and we generated columns for fields,
// we try to map as directly as possible.
// For complex field updates (dot notation), we might need to handle them carefully.

export const dbAdapter = {
    collection: (collectionName: string) => {
        return {
            getDocs: async () => {
                const { data, error } = await supabase.from(collectionName).select('*');
                if (error) {
                    console.error(`Error getting docs from ${collectionName}:`, error);
                    return { docs: [], size: 0, empty: true, forEach: () => { } };
                }

                const docs = data.map((doc: any) => ({
                    id: doc.id,
                    ...doc,
                    data: () => doc,
                    ref: dbAdapter.doc(collectionName, doc.id)
                }));

                return {
                    docs,
                    size: docs.length,
                    empty: docs.length === 0,
                    forEach: (callback: (doc: any) => void) => docs.forEach(callback)
                };
            },
            add: async (data: any) => {
                // Generate ID or let Supabase do it? 
                // The generic SQL used TEXT PRIMARY KEY, so we can generate one or let DB do it if default provided.
                // We'll generate one to be safe and match behavior
                const id = data.id || Math.random().toString(36).substring(2, 15);
                const payload = { ...data, id };

                const { error } = await supabase.from(collectionName).insert(payload);
                if (error) {
                    console.error(`Error adding to ${collectionName}:`, error);
                    throw error;
                }
                return { id, ...data };
            }
        };
    },

    doc: (collectionName: string, id: string) => {
        return {
            id,
            path: `${collectionName}/${id}`,
            get: async () => {
                const { data, error } = await supabase.from(collectionName).select('*').eq('id', id).single();

                // Supabase returns error code PGRST116 if no rows found.
                const exists = !error && data;

                return {
                    id,
                    exists: () => !!exists,
                    data: () => exists ? data : undefined
                };
            },
            set: async (data: any, options?: { merge: boolean }) => {
                if (options?.merge) {
                    const { error } = await supabase.from(collectionName).upsert({ ...data, id });
                    if (error) throw error;
                } else {
                    const { error } = await supabase.from(collectionName).upsert({ ...data, id });
                    if (error) throw error;
                }
            },
            update: async (data: any) => {
                // Usage often includes __op: increment etc.
                // We need to fetch first to apply these if present, OR just try strictly if simple.
                // Given the codebase, let's do fetch-modify-write for safety with these custom ops.

                // optimize: check if we have special ops
                const hasSpecialOps = Object.values(data).some((val: any) => val && typeof val === 'object' && val.__op);
                const hasDotNotation = Object.keys(data).some(k => k.includes('.'));

                if (hasSpecialOps || hasDotNotation) {
                    const { data: current, error: fetchError } = await supabase.from(collectionName).select('*').eq('id', id).single();
                    if (fetchError || !current) throw new Error("Document not found for update");

                    const updated = { ...current };

                    for (const key in data) {
                        if (key.includes('.')) {
                            // Nested update
                            const parts = key.split('.');
                            let target = updated;
                            for (let i = 0; i < parts.length - 1; i++) {
                                if (!target[parts[i]]) target[parts[i]] = {};
                                target = target[parts[i]];
                            }
                            target[parts[parts.length - 1]] = data[key];
                        } else if (data[key] && typeof data[key] === 'object' && data[key].__op === 'increment') {
                            updated[key] = (Number(updated[key]) || 0) + data[key].value;
                        } else if (data[key] && typeof data[key] === 'object' && data[key].__op === 'arrayUnion') {
                            if (!Array.isArray(updated[key])) updated[key] = [];
                            if (!updated[key].includes(data[key].value)) updated[key].push(data[key].value);
                        } else {
                            updated[key] = data[key];
                        }
                    }

                    const { error } = await supabase.from(collectionName).update(updated).eq('id', id);
                    if (error) throw error;

                } else {
                    // Simple update
                    const { error } = await supabase.from(collectionName).update(data).eq('id', id);
                    if (error) throw error;
                }
            },
            delete: async () => {
                const { error } = await supabase.from(collectionName).delete().eq('id', id);
                if (error) throw error;
            },
            // Legacy/Internal helpers - likely not needed but kept empty/basic to avoid crashes if called
            _applySet: () => { },
            _applyUpdate: () => { },
            _applyDelete: () => { }
        };
    },

    // query simulation
    query: async (collectionName: string, conditions: any[]) => {
        let query: any = supabase.from(collectionName).select('*');

        for (const cond of conditions) {
            if (cond.op === '==') {
                query = query.eq(cond.field, cond.value);
            } else if (cond.op === 'in') {
                query = query.in(cond.field, cond.value);
            } else if (cond.op === 'array-contains') {
                // Postgres array contains
                query = query.contains(cond.field, [cond.value]);
            }
            // Add other ops as encountered
        }

        const { data, error } = await query;
        if (error) {
            console.error(`Query error in ${collectionName}:`, error);
            return { docs: [], size: 0, empty: true, forEach: () => { } };
        }

        const docs = (data || []).map((doc: any) => ({
            id: doc.id,
            ...doc,
            data: () => doc,
            ref: dbAdapter.doc(collectionName, doc.id)
        }));

        return {
            docs,
            size: docs.length,
            empty: docs.length === 0,
            forEach: (callback: (doc: any) => void) => docs.forEach(callback)
        };
    },

    // Transaction simulation
    // We can't do real multi-step transactions easily with simple client usage without RPC.
    // We will execute the steps sequentially.
    runTransaction: async (updateFunction: (transaction: any) => Promise<any>) => {
        const transaction = {
            get: async (docRef: any) => {
                return docRef.get();
            },
            set: async (docRef: any, data: any, options?: any) => {
                // If docRef is a promise (from previous logic?), await it? 
                // Our doc() returns an object immediately.
                if (docRef.set) {
                    await docRef.set(data, options);
                }
            },
            update: async (docRef: any, data: any) => {
                if (docRef.update) {
                    await docRef.update(data);
                }
            }
        };

        // We execute the function. 
        // Note: This is NOT ATOMIC. If step 2 fails, step 1 is not rolled back.
        // For this admin app, we accept this risk for now vs writing custom Postgres functions.
        return await updateFunction(transaction);
    }
};

// Helpers for query construction
export const where = (field: string, op: string, value: any) => ({ field, op, value });
export const increment = (value: number) => ({ __op: 'increment', value });
export const arrayUnion = (value: any) => ({ __op: 'arrayUnion', value });
