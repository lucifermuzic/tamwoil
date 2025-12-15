// @ts-nocheck
// lib/actions.ts
"use server";

import { dbAdapter } from "./db-adapter";
import { where, increment, arrayUnion } from "./db-adapter";
import { Manager, User, Representative, Order, Transaction, TempOrder, Conversation, Message, Notification, AppSettings, OrderStatus, Expense, Deposit, DepositStatus, ExternalDebt, Creditor, ManualShippingLabel, SubOrder, InstantSale } from "./types";

// Map adapter methods to Firebase names for minimal code changes
const db = dbAdapter;
const collection = (d: any, name: string) => name;
const doc = (d: any, col?: string, id?: string) => {
    if (typeof d === 'string') {
        // Handle doc(collectionName) -> Auto-generate ID
        const newId = Math.random().toString(36).substring(2, 15);
        return dbAdapter.doc(d, newId);
    }
    // Handle doc(db, collection, id)
    if (col && id) {
        return d.doc(col, id);
    }
    throw new Error("Invalid doc usage");
};

// Fixed getDocs to handle various inputs (string collection, query object, or existing ref)
const getDocs = async (q: any) => {
    if (typeof q === 'string') {
        // e.g. getDocs('users')
        return dbAdapter.collection(q).getDocs();
    } else if (q && q.type === 'query') {
        // e.g. getDocs(query(...))
        return dbAdapter.query(q.collection, q.conditions);
    } else if (q && q.getDocs) {
        // doc ref or collection ref with getDocs
        return q.getDocs();
    } else if (q && q.path) {
        // legacy handling for doc ref
        const parts = q.path.split('/');
        if (parts.length === 2) return dbAdapter.doc(parts[0], parts[1]).get();
    }
    throw new Error("Invalid query passed to getDocs");
};

const getDoc = async (ref: any) => ref.get();
const addDoc = async (collectionName: string, data: any) => dbAdapter.collection(collectionName).add(data);
const updateDoc = async (ref: any, data: any) => ref.update(data);
const setDoc = async (ref: any, data: any, options?: any) => ref.set(data, options);
const deleteDoc = async (ref: any) => ref.delete();
// Fixed query to be synchronous and return a description
const query = (collectionName: string, ...conditions: any[]) => {
    return {
        type: 'query',
        collection: collectionName,
        conditions: conditions
    };
};
const writeBatch = (d: any) => {
    const promises: Promise<any>[] = [];
    return {
        update: (ref: any, data: any) => {
            promises.push(ref.update(data));
        },
        delete: (ref: any) => {
            promises.push(ref.delete());
        },
        commit: async () => {
            console.log("Committing batch with", promises.length, "operations");
            try {
                const results = await Promise.all(promises);
                console.log("Batch committed successfully", results);
            } catch (e) {
                console.error("Batch commit failed:", e);
                throw e;
            }
        },
        set: (ref: any, data: any, options?: any) => {
            promises.push(ref.set(data, options));
        }
    };
};
const firestoreWriteBatch = writeBatch;
const runTransaction = (d: any, fn: any) => dbAdapter.runTransaction(fn);
// Stub for things we don't strictly need or handled differently
const or = (...args: any[]) => args;

const MANAGERS_COLLECTION = 'managers_v4';
const USERS_COLLECTION = 'users_v4';
const REPRESENTATIVES_COLLECTION = 'representatives_v4';
const ORDERS_COLLECTION = 'orders_v4';
const TEMP_ORDERS_COLLECTION = 'tempOrders_v4';
const TRANSACTIONS_COLLECTION = 'transactions_v4';
const CONVERSATIONS_COLLECTION = 'conversations_v4';
const NOTIFICATIONS_COLLECTION = 'notifications_v4';
const SETTINGS_COLLECTION = 'settings_v4';
const EXPENSES_COLLECTION = 'expenses_v4';
const DEPOSITS_COLLECTION = 'deposits_v4';
const EXTERNAL_DEBTS_COLLECTION = 'externalDebts_v4';
const CREDITORS_COLLECTION = 'creditors_v4';
const MANUAL_LABELS_COLLECTION = 'manual_labels_v4';
const INSTANT_SALES_COLLECTION = 'instant_sales_v4';


// --- Recalculation Function for Data Integrity ---
/**
 * Recalulates the total debt and order count for a specific user.
 * This function queries all non-cancelled orders for the user, 
 * sums up the remaining amounts, and updates the user document.
 * This ensures data consistency.
 * @param userId - The ID of the user to recalculate stats for.
 */
export async function recalculateUserStats(userId: string): Promise<void> {
    try {
        console.log(`Recalculating stats for user: ${userId}`);
        const userRef = doc(db, USERS_COLLECTION, userId);

        let totalDebt = 0;
        let orderCount = 0;

        // 1. Calculate debt from regular orders
        const activeStatuses: OrderStatus[] = ['pending', 'processed', 'ready', 'shipped', 'arrived_dubai', 'arrived_benghazi', 'arrived_tobruk', 'out_for_delivery', 'delivered', 'paid'];
        const userOrdersQuery = query(
            collection(db, ORDERS_COLLECTION),
            where("userId", "==", userId),
            where("status", "in", activeStatuses)
        );
        const orderQuerySnapshot = await getDocs(userOrdersQuery);
        orderCount += orderQuerySnapshot.size;
        orderQuerySnapshot.forEach(doc => {
            totalDebt += (doc.data() as Order).remainingAmount || 0;
        });
        console.log(`Debt from regular orders for ${userId}: ${totalDebt}`);

        // 2. Find all TempOrders assigned DIRECTLY to the user and add their debt,
        // ONLY if they haven't been converted to a main order (to avoid double counting).
        const tempOrdersDirectQuery = query(
            collection(db, TEMP_ORDERS_COLLECTION),
            where("assignedUserId", "==", userId),
            where("parentInvoiceId", "==", null) // Important: Only count un-converted temp orders
        );
        const tempOrdersDirectSnapshot = await getDocs(tempOrdersDirectQuery);
        tempOrdersDirectSnapshot.forEach(doc => {
            const tempOrderData = doc.data() as TempOrder;
            if (tempOrderData.status !== 'cancelled') {
                totalDebt += tempOrderData.remainingAmount || 0;
            }
        });
        console.log(`Debt after adding direct TempOrders for ${userId}: ${totalDebt}`);

        // 3. Update the user document
        await updateDoc(userRef, {
            debt: totalDebt,
            orderCount: orderCount
        });
        console.log(`Successfully updated user ${userId} with debt: ${totalDebt} and orderCount: ${orderCount}`);

    } catch (error) {
        console.error(`Error recalculating stats for user ${userId}:`, error);
        // We throw the error so the calling function knows something went wrong.
        throw error;
    }
}


// --- Settings Actions ---
export async function getAppSettings(): Promise<AppSettings> {
    try {
        const settingsRef = doc(db, SETTINGS_COLLECTION, 'main');
        const docSnap = await getDoc(settingsRef);

        const defaults: AppSettings = {
            exchangeRate: 1,
            pricePerKiloLYD: 0,
            pricePerKiloUSD: 0,
        };

        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                exchangeRate: data.exchangeRate ?? defaults.exchangeRate,
                pricePerKiloLYD: data.pricePerKiloLYD ?? defaults.pricePerKiloLYD,
                pricePerKiloUSD: data.pricePerKiloUSD ?? defaults.pricePerKiloUSD,
            };
        } else {
            // If the document doesn't exist, create it with default values
            await setDoc(settingsRef, defaults);
            return defaults;
        }
    } catch (error) {
        console.error("Error getting app settings:", error);
        return { exchangeRate: 1, pricePerKiloLYD: 0, pricePerKiloUSD: 0 };
    }
}

// Added for export
export async function getRawAppSettings(): Promise<Partial<AppSettings>> {
    try {
        const settingsRef = doc(db, SETTINGS_COLLECTION, 'main');
        const docSnap = await getDoc(settingsRef);
        return docSnap.exists() ? docSnap.data() : {};
    } catch (error) {
        console.error("Error getting raw app settings:", error);
        return {};
    }
}


export async function updateAppSettings(data: Partial<AppSettings>): Promise<boolean> {
    try {
        const settingsRef = doc(db, SETTINGS_COLLECTION, 'main');
        // Use set with merge option to create the document if it doesn't exist, or update it if it does.
        await setDoc(settingsRef, data, { merge: true });
        return true;
    } catch (error) {
        console.error("Error updating app settings:", error);
        return false;
    }
}


// --- Manager Actions ---
export async function ensureDefaultAdminExists() {
    const defaultUsername = 'admin@tamweelsys.app';
    const docRef = doc(db, MANAGERS_COLLECTION, defaultUsername); // Use email as ID for simplicity
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        console.log("Default admin not found, creating one...");
        const defaultAdmin: Omit<Manager, 'id'> = {
            name: 'المدير العام',
            username: defaultUsername,
            password: '0920064400',
            phone: '0920064400',
            permissions: ['users', 'employees', 'representatives', 'orders', 'shipping_label', 'temporary_users', 'financial_reports', 'instant_sales', 'deposits', 'expenses', 'creditors', 'support', 'notifications', 'exchange_rate', 'data_export']
        };
        try {
            await setDoc(docRef, defaultAdmin);
            console.log("Default admin created successfully.");
        } catch (error) {
            console.error("Error creating default admin:", error);
        }
    }
}


export async function getManagers(): Promise<Manager[]> {
    try {
        const querySnapshot = await getDocs(collection(db, MANAGERS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Manager));
    } catch (error) {
        console.error("Error getting managers:", error);
        return [];
    }
}

export async function getManagerById(managerId: string): Promise<Manager | null> {
    try {
        // Because we might be using email as ID for default admin
        const managerRef = doc(db, MANAGERS_COLLECTION, managerId);
        const docSnap = await getDoc(managerRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Manager;
        }
        // Fallback for old IDs that might not be the email
        const q = query(collection(db, MANAGERS_COLLECTION), where("id", "==", managerId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const oldDoc = querySnapshot.docs[0];
            return { id: oldDoc.id, ...oldDoc.data() } as Manager;
        }

        return null;
    } catch (error) {
        console.error("Error getting manager by ID:", error);
        return null;
    }
}

export async function getManagerByUsername(username: string): Promise<Manager | null> {
    try {
        const q = query(
            collection(db, MANAGERS_COLLECTION),
            where("username", "==", username)
        );
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { id: doc.id, ...doc.data() } as Manager;
        }
        return null;
    } catch (error) {
        console.error("Firestore error in getManagerByUsername:", error);
        return null;
    }
}

export async function addManager(manager: Omit<Manager, 'id'>): Promise<Manager | null> {
    try {
        const docRef = await addDoc(collection(db, MANAGERS_COLLECTION), manager);
        return { id: docRef.id, ...manager };
    } catch (error) {
        console.error("Error adding manager:", error);
        return null;
    }
}

export async function updateManager(managerId: string, data: Partial<Manager>): Promise<boolean> {
    try {
        const managerRef = doc(db, MANAGERS_COLLECTION, managerId);
        await updateDoc(managerRef, data);
        return true;
    } catch (error) {
        console.error("Error updating manager:", error);
        return false;
    }
}

export async function deleteManager(managerId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, MANAGERS_COLLECTION, managerId));
        return true;
    } catch (error) {
        console.error("Error deleting manager:", error);
        return false;
    }
}

// --- User Actions ---

export async function getUsers(): Promise<User[]> {
    try {
        const querySnapshot = await getDocs(collection(db, USERS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    } catch (error) {
        console.error("Error getting users:", error);
        return [];
    }
}

export async function getUserById(userId: string): Promise<User | null> {
    try {
        // Ensure data is up-to-date before fetching
        await recalculateUserStats(userId);

        const userRef = doc(db, USERS_COLLECTION, userId);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as User;
        }

        // Fallback for temporary users from imported invoices
        const tempOrderRef = doc(db, TEMP_ORDERS_COLLECTION, userId);
        const tempOrderSnap = await getDoc(tempOrderRef);
        if (tempOrderSnap.exists()) {
            const tempData = tempOrderSnap.data() as TempOrder;
            // We create a "fake" user object for compatibility
            return {
                id: tempData.id,
                name: tempData.invoiceName,
                username: tempData.invoiceName, // or some other identifier
                phone: '',
                orderCount: tempData.subOrders.length,
                debt: tempData.remainingAmount,
            };
        }

        return null;
    } catch (error) {
        console.error("Error getting user by ID:", error);
        return null;
    }
}

export async function getOrdersByUserId(userId: string): Promise<Order[]> {
    try {
        const q = query(
            collection(db, ORDERS_COLLECTION),
            where("userId", "==", userId)
        );
        const querySnapshot = await getDocs(q);
        const orders = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
        return orders.sort((a, b) => new Date(b.operationDate).getTime() - new Date(a.operationDate).getTime());
    } catch (error) {
        console.error(`Error getting orders for user ${userId}:`, error);
        return [];
    }
}


export async function getUserByPhone(phone: string): Promise<User | null> {
    try {
        const q = query(collection(db, USERS_COLLECTION), where("phone", "==", phone));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { id: doc.id, ...doc.data() } as User;
        }
        return null;
    } catch (error) {
        console.error("Error getting user by phone:", error);
        return null;
    }
}

export async function addUser(user: Omit<User, 'id'>): Promise<User | null> {
    try {
        const docRef = await addDoc(collection(db, USERS_COLLECTION), user);
        return { id: docRef.id, ...user };
    } catch (error) {
        console.error("Error adding user:", error);
        return null;
    }
}

export async function updateUser(userId: string, data: Partial<User>): Promise<boolean> {
    try {
        const userRef = doc(db, USERS_COLLECTION, userId);
        await updateDoc(userRef, data);
        return true;
    } catch (error) {
        console.error("Error updating user:", error);
        return false;
    }
}

export async function deleteUser(userId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, USERS_COLLECTION, userId));
        return true;
    } catch (error) {
        console.error("Error deleting user:", error);
        return false;
    }
}


// --- Representative Actions ---

export async function getRepresentatives(): Promise<Representative[]> {
    try {
        const querySnapshot = await getDocs(collection(db, REPRESENTATIVES_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Representative));
    } catch (error) {
        console.error("Error getting representatives:", error);
        return [];
    }
}

export async function getRepresentativeById(repId: string): Promise<Representative | null> {
    try {
        const repRef = doc(db, REPRESENTATIVES_COLLECTION, repId);
        const docSnap = await getDoc(repRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Representative;
        }
        return null;
    } catch (error) {
        console.error("Error getting representative by ID:", error);
        return null;
    }
}

export async function getRepresentativeByUsername(username: string): Promise<Representative | null> {
    try {
        const q = query(collection(db, REPRESENTATIVES_COLLECTION), where("username", "==", username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { id: doc.id, ...doc.data() } as Representative;
        }
        return null;
    } catch (error) {
        console.error("Error getting representative by username:", error);
        return null;
    }
}

export async function addRepresentative(rep: Omit<Representative, 'id'>): Promise<Representative | null> {
    try {
        const docRef = await addDoc(collection(db, REPRESENTATIVES_COLLECTION), rep);
        return { id: docRef.id, ...rep };
    } catch (error) {
        console.error("Error adding representative:", error);
        return null;
    }
}

export async function updateRepresentative(repId: string, data: Partial<Representative>): Promise<boolean> {
    try {
        const repRef = doc(db, REPRESENTATIVES_COLLECTION, repId);
        await updateDoc(repRef, data);
        return true;
    } catch (error) {
        console.error("Error updating representative:", error);
        return false;
    }
}

export async function deleteRepresentative(repId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, REPRESENTATIVES_COLLECTION, repId));
        return true;
    } catch (error) {
        console.error("Error deleting representative:", error);
        return false;
    }
}

// --- Order Actions ---

export async function getOrders(): Promise<Order[]> {
    try {
        const querySnapshot = await getDocs(collection(db, ORDERS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
    } catch (error) {
        console.error("Error getting orders:", error);
        return [];
    }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
    try {
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);
        const docSnap = await getDoc(orderRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Order;
        }
        return null;
    } catch (error) {
        console.error("Error getting order by ID:", error);
        return null;
    }
}


export async function getOrdersByRepresentativeId(repId: string): Promise<Order[]> {
    try {
        const q = query(
            collection(db, ORDERS_COLLECTION),
            where("representativeId", "==", repId)
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
    } catch (error) {
        console.error("Error getting orders for representative:", error);
        return [];
    }
}


export async function getOrderByTrackingId(trackingId: string): Promise<Order | null> {
    try {
        const q = query(collection(db, ORDERS_COLLECTION), where("trackingId", "==", trackingId));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { id: doc.id, ...doc.data() } as Order;
        }
        return null;
    } catch (error) {
        console.error("Error getting order by tracking ID:", error);
        return null;
    }
}

export async function addOrder(orderData: Omit<Order, 'id' | 'invoiceNumber'>): Promise<Order | null> {
    try {
        const newDocRef = await runTransaction(db, async (transaction) => {
            const userRef = doc(db, USERS_COLLECTION, orderData.userId);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) {
                throw new Error(`User with ID ${orderData.userId} does not exist!`);
            }

            const settings = await getAppSettings();

            const userData = userDoc.data();
            const newOrderCount = (userData.orderCounter || 0) + 1;
            const invoiceNumber = `${userData.username}-${String(newOrderCount).padStart(2, '0')}`;
            const finalTrackingId = orderData.trackingId || Math.random().toString(36).substring(2, 10).toUpperCase();

            // Correctly calculate remainingAmount at creation
            const remainingAmount = (orderData.sellingPriceLYD || 0) - (orderData.downPaymentLYD || 0);

            const finalOrderData: Omit<Order, 'id'> = {
                ...orderData,
                invoiceNumber: invoiceNumber,
                trackingId: finalTrackingId,
                exchangeRate: settings.exchangeRate,
                remainingAmount: remainingAmount, // Use the correctly calculated amount
            };

            const orderRef = doc(collection(db, ORDERS_COLLECTION));
            transaction.set(orderRef, finalOrderData);

            // Create main transaction for the order's full value
            const orderTransactionRef = doc(collection(db, TRANSACTIONS_COLLECTION));
            transaction.set(orderTransactionRef, {
                orderId: orderRef.id,
                customerId: finalOrderData.userId,
                customerName: finalOrderData.customerName,
                date: finalOrderData.operationDate,
                type: 'order',
                status: finalOrderData.status,
                amount: finalOrderData.sellingPriceLYD,
                description: `إنشاء طلب جديد ${invoiceNumber}`
            });

            // If there's a down payment, create a separate payment transaction
            if (finalOrderData.downPaymentLYD && finalOrderData.downPaymentLYD > 0) {
                const paymentTransactionRef = doc(collection(db, TRANSACTIONS_COLLECTION));
                transaction.set(paymentTransactionRef, {
                    orderId: orderRef.id,
                    customerId: finalOrderData.userId,
                    customerName: finalOrderData.customerName,
                    date: finalOrderData.operationDate,
                    type: 'payment',
                    status: 'paid',
                    amount: finalOrderData.downPaymentLYD,
                    description: `دفعة مقدمة للطلب ${invoiceNumber}`
                });
            }

            transaction.update(userRef, {
                orderCounter: increment(1)
            });

            return orderRef;
        });

        // After the transaction completes, update stats and return the created order
        const newOrderSnap = await getDoc(newDocRef);
        if (newOrderSnap.exists()) {
            const newOrderData = { id: newOrderSnap.id, ...newOrderSnap.data() } as Order;
            await recalculateUserStats(newOrderData.userId);
            return newOrderData;
        }
        return null;

    } catch (error) {
        console.error("Error adding order:", error);
        return null;
    }
}

export async function updateOrder(orderId: string, data: Partial<Omit<Order, 'id' | 'invoiceNumber'>>): Promise<boolean> {
    try {
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);

        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            console.error("Order not found, cannot update.");
            return false;
        }
        const userId = orderSnap.data().userId;

        await updateDoc(orderRef, data);

        if (userId) {
            await recalculateUserStats(userId);
        }

        return true;
    } catch (error) {
        console.error("Error updating order:", error);
        return false;
    }
}

export async function addCustomerShippingCost(orderId: string, costInUSD: number): Promise<boolean> {
    if (costInUSD < 0) return false;
    const orderRef = doc(db, ORDERS_COLLECTION, orderId);

    try {
        await runTransaction(db, async (transaction) => {
            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists()) {
                throw new Error("Order document does not exist!");
            }

            const orderData = orderDoc.data() as Order;

            const currentCustomerWeightCostUSD = orderData.customerWeightCostUSD || 0;
            const currentSellingPrice = orderData.sellingPriceLYD || 0;

            const exchangeRate = orderData.exchangeRate || (await getAppSettings()).exchangeRate;

            const costDifferenceUSD = costInUSD - currentCustomerWeightCostUSD;
            const costDifferenceLYD = costDifferenceUSD * exchangeRate;

            const newSellingPrice = currentSellingPrice + costDifferenceLYD;

            transaction.update(orderRef, {
                sellingPriceLYD: newSellingPrice,
                remainingAmount: increment(costDifferenceLYD), // Correctly increment the remaining amount
                customerWeightCostUSD: costInUSD,
            });
        });

        // After transaction, recalculate stats for the user to ensure data integrity
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
            const userId = orderSnap.data().userId;
            if (userId) {
                await recalculateUserStats(userId);
            }
        }

        return true;
    } catch (error) {
        console.error("Error in addCustomerShippingCost transaction:", error);
        return false;
    }
}

export async function setCustomerWeightDetails(orderId: string, weight: number, companyPricePerKiloUSD: number, customerPricePerKilo: number): Promise<boolean> {
    if (weight < 0) return false; // Allow 0 to potentially clear it? Let's assume non-negative.
    const orderRef = doc(db, ORDERS_COLLECTION, orderId);

    try {
        await runTransaction(db, async (transaction) => {
            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists()) {
                throw new Error("Order document does not exist!");
            }

            const orderData = orderDoc.data() as Order;
            const currentSellingPrice = orderData.sellingPriceLYD || 0;
            const currentRemaining = orderData.remainingAmount || 0;

            // Previous values
            const oldCustomerWeightCost = orderData.customerWeightCost || 0;
            // No need to check old company cost for the delta of debt/selling price, only customer cost affects user wallet.

            // New values
            const newCustomerTotalCostLYD = weight * customerPricePerKilo;
            const newCompanyTotalCostUSD = weight * companyPricePerKiloUSD;

            // Delta
            const costDifference = newCustomerTotalCostLYD - oldCustomerWeightCost;

            transaction.update(orderRef, {
                sellingPriceLYD: currentSellingPrice + costDifference,
                remainingAmount: currentRemaining + costDifference,
                weightKG: weight,
                companyPricePerKiloUSD: companyPricePerKiloUSD,
                customerPricePerKilo: customerPricePerKilo,
                customerWeightCost: newCustomerTotalCostLYD,
                companyWeightCostUSD: newCompanyTotalCostUSD,
            });

            // Log Transaction if there is a difference
            if (costDifference !== 0) {
                const transactionRef = doc(collection(db, TRANSACTIONS_COLLECTION));
                const newTransaction = {
                    orderId: orderId,
                    customerId: orderData.userId,
                    customerName: orderData.customerName,
                    date: new Date().toISOString(),
                    type: 'order', // Using 'order' type as it affects the order value/debt
                    status: 'completed',
                    amount: costDifference, // Can be negative for reductions
                    description: `تعديل وزن الزبون: ${weight} كجم (السابق: ${(oldCustomerWeightCost / (customerPricePerKilo || 1)).toFixed(2)} كجم)`
                };
                transaction.set(transactionRef, newTransaction);
            }
        });

        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
            const userId = orderSnap.data().userId;
            if (userId) {
                await recalculateUserStats(userId);
            }
        }

        return true;
    } catch (error) {
        console.error("Error in setCustomerWeightDetails:", error);
        return false;
    }
}

export async function assignRepresentativeToOrder(orderId: string, rep: Representative): Promise<boolean> {
    try {
        const batch = writeBatch(db);
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);

        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            throw new Error("Order to assign not found");
        }
        const orderData = orderSnap.data() as Order;

        if (orderData.representativeId) {
            const oldRepRef = doc(db, REPRESENTATIVES_COLLECTION, orderData.representativeId);
            batch.update(oldRepRef, { assignedOrders: increment(-1) });
        }

        batch.update(orderRef, {
            representativeId: rep.id,
            representativeName: rep.name,
            status: 'out_for_delivery'
        });

        const newRepRef = doc(db, REPRESENTATIVES_COLLECTION, rep.id);
        batch.update(newRepRef, { assignedOrders: increment(1) });

        await batch.commit();
        return true;
    } catch (error) {
        console.error("Error assigning representative:", error);
        return false;
    }
}

export async function unassignRepresentativeFromOrder(orderId: string): Promise<boolean> {
    try {
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);
        const orderSnap = await getDoc(orderRef);

        if (!orderSnap.exists()) {
            throw new Error("Order not found");
        }

        const orderData = orderSnap.data() as Order;
        const currentRepId = orderData.representativeId;

        if (!currentRepId) {
            return true;
        }

        const batch = writeBatch(db);

        const repRef = doc(db, REPRESENTATIVES_COLLECTION, currentRepId);
        batch.update(repRef, { assignedOrders: increment(-1) });

        batch.update(orderRef, {
            representativeId: null,
            representativeName: null,
            status: 'ready'
        });

        await batch.commit();
        return true;
    } catch (error) {
        console.error("Error unassigning representative:", error);
        return false;
    }
}


export async function deleteOrder(orderId: string): Promise<boolean> {
    try {
        console.log("Attempting to delete order:", orderId);
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            console.error("Order not found:", orderId);
            throw new Error("Order to delete not found");
        }
        console.log("Order found, proceeding with delete. User ID:", orderSnap.data().userId);
        const orderData = orderSnap.data() as Order;
        const userId = orderData.userId;

        const batch = writeBatch(db);

        if (orderData.representativeId) {
            const repRef = doc(db, REPRESENTATIVES_COLLECTION, orderData.representativeId);
            batch.update(repRef, { assignedOrders: increment(-1) });
        }

        const transactionsQuery = query(collection(db, TRANSACTIONS_COLLECTION), where("orderId", "==", orderId));
        const transactionsSnapshot = await getDocs(transactionsQuery);
        transactionsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        batch.delete(orderRef);
        await batch.commit();
        console.log("Batch commit finished for deleteOrder");

        if (userId) {
            await recalculateUserStats(userId);
        }

        return true;
    } catch (error) {
        console.error("Error deleting order and its transactions:", error);
        return false;
    }
}

export async function recordRepresentativePayment(orderId: string, collectedAmount: number): Promise<boolean> {
    try {
        const orderRef = doc(db, ORDERS_COLLECTION, orderId);

        await updateDoc(orderRef, {
            status: 'delivered',
            deliveryDate: new Date().toISOString(),
            collectedAmount: collectedAmount,
        });

        return true;

    } catch (error) {
        console.error("Error recording representative payment:", error);
        return false;
    }
}

export async function bulkDeleteOrders(orderIds: string[]): Promise<boolean> {
    if (orderIds.length === 0) return true;
    try {
        const usersToRecalculate = new Set<string>();

        const batch = firestoreWriteBatch(db);

        for (const orderId of orderIds) {
            const orderRef = doc(db, ORDERS_COLLECTION, orderId);
            const orderSnap = await getDoc(orderRef);

            if (orderSnap.exists()) {
                const orderData = orderSnap.data() as Order;

                if (orderData.userId) usersToRecalculate.add(orderData.userId);

                if (orderData.representativeId) {
                    const repRef = doc(db, REPRESENTATIVES_COLLECTION, orderData.representativeId);
                    batch.update(repRef, { assignedOrders: increment(-1) });
                }

                batch.delete(orderRef);

                const transactionsQuery = query(collection(db, TRANSACTIONS_COLLECTION), where("orderId", "==", orderId));
                const transactionsSnapshot = await getDocs(transactionsQuery);
                transactionsSnapshot.forEach(transactionDoc => {
                    batch.delete(transactionDoc.ref);
                });
            }
        }

        await batch.commit();

        for (const userId of usersToRecalculate) {
            await recalculateUserStats(userId);
        }

        return true;
    } catch (error) {
        console.error("Error in bulkDeleteOrders:", error);
        return false;
    }
}

export async function bulkUpdateOrdersStatus(orderIds: string[], status: OrderStatus): Promise<boolean> {
    if (orderIds.length === 0) return true;
    try {
        const batch = firestoreWriteBatch(db);
        orderIds.forEach(id => {
            const orderRef = doc(db, ORDERS_COLLECTION, id);
            batch.update(orderRef, { status: status });
        });
        await batch.commit();
        return true;
    } catch (error) {
        console.error("Error in bulkUpdateOrdersStatus:", error);
        return false;
    }
}

export async function bulkAssignRepresentative(orderIds: string[], rep: Representative): Promise<boolean> {
    if (orderIds.length === 0) return true;
    try {
        const batch = firestoreWriteBatch(db);
        const repRef = doc(db, REPRESENTATIVES_COLLECTION, rep.id);

        for (const orderId of orderIds) {
            const orderRef = doc(db, ORDERS_COLLECTION, orderId);
            batch.update(orderRef, {
                representativeId: rep.id,
                representativeName: rep.name,
                status: 'out_for_delivery'
            });
        }

        batch.update(repRef, { assignedOrders: increment(orderIds.length) });

        await batch.commit();
        return true;
    } catch (error) {
        console.error("Error in bulkAssignRepresentative:", error);
        return false;
    }
}


// --- TempOrder Actions ---

export async function getTempOrders(): Promise<TempOrder[]> {
    try {
        const querySnapshot = await getDocs(query(collection(db, TEMP_ORDERS_COLLECTION), where("status", "!=", "cancelled")));
        return querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                subOrders: Array.isArray(data.subOrders) ? data.subOrders : []
            } as TempOrder;
        })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        console.error("Error getting temp orders:", error);
        return [];
    }
}

export async function getTempOrderById(orderId: string): Promise<TempOrder | null> {
    try {
        const docRef = doc(db, TEMP_ORDERS_COLLECTION, orderId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                ...data,
                subOrders: Array.isArray(data.subOrders) ? data.subOrders : []
            } as TempOrder;
        }
        return null;
    } catch (error) {
        console.error("Error getting temp order by id:", error);
        return null;
    }
}

export async function getTempSubOrdersByRepresentativeId(repId: string): Promise<SubOrder[]> {
    try {
        const q = query(collection(db, TEMP_ORDERS_COLLECTION));
        const querySnapshot = await getDocs(q);

        const assignedSubOrders: SubOrder[] = [];

        querySnapshot.forEach(doc => {
            const tempOrder = doc.data() as TempOrder;
            tempOrder.subOrders.forEach(subOrder => {
                if (subOrder.representativeId === repId) {
                    assignedSubOrders.push({
                        ...subOrder,
                        invoiceName: tempOrder.invoiceName
                    });
                }
            });
        });

        return assignedSubOrders;
    } catch (error) {
        console.error("Error getting temp sub-orders for representative:", error);
        return [];
    }
}


export async function addTempOrder(order: Omit<TempOrder, 'id'>): Promise<TempOrder | null> {
    try {
        if (order.assignedUserId && order.assignedUserName) {
            const downPayment = order.totalAmount - order.remainingAmount;

            const mainOrder = await addOrder({
                userId: order.assignedUserId,
                customerName: order.assignedUserName,
                customerPhone: (await getUserById(order.assignedUserId))?.phone || '',
                operationDate: new Date().toISOString(),
                sellingPriceLYD: order.totalAmount,
                downPaymentLYD: downPayment,
                status: 'pending',
                productLinks: order.subOrders.map(so => so.productLinks).join('\\n'),
                itemDescription: `فاتورة مجمعة: ${order.invoiceName}`,
                exchangeRate: (await getAppSettings()).exchangeRate,
                trackingId: '', // Will be auto-generated
                remainingAmount: order.remainingAmount,
            });

            if (!mainOrder) {
                throw new Error("Failed to create the main order for the temp batch.");
            }

            const tempOrderRef = doc(collection(db, TEMP_ORDERS_COLLECTION));
            const finalOrderData = {
                ...order,
                createdAt: new Date().toISOString(),
                parentInvoiceId: mainOrder.id
            };
            await setDoc(tempOrderRef, finalOrderData);
            return { id: tempOrderRef.id, ...finalOrderData };
        } else {
            const tempOrderRef = doc(collection(db, TEMP_ORDERS_COLLECTION));
            const finalOrderData = { ...order, createdAt: new Date().toISOString() };
            await setDoc(tempOrderRef, finalOrderData);
            return { id: tempOrderRef.id, ...finalOrderData };
        }

    } catch (error) {
        console.error("Error in addTempOrder:", error);
        return null;
    }
}


export async function updateTempOrder(orderId: string, data: Partial<TempOrder>): Promise<boolean> {
    try {
        const orderRef = doc(db, TEMP_ORDERS_COLLECTION, orderId);
        const usersToUpdate = new Set<string>();

        const oldDocSnap = await getDoc(orderRef);
        if (!oldDocSnap.exists()) {
            throw new Error("TempOrder not found");
        }
        const oldData = oldDocSnap.data() as TempOrder;

        if (oldData.assignedUserId) usersToUpdate.add(oldData.assignedUserId);
        if (data.assignedUserId) usersToUpdate.add(data.assignedUserId);

        await updateDoc(orderRef, data);

        // If newly assigned, create or update the main order
        if (data.assignedUserId && !oldData.assignedUserId) {
            const updatedTempOrder = { ...oldData, ...data };
            const downPayment = updatedTempOrder.totalAmount - updatedTempOrder.remainingAmount;

            const mainOrder = await addOrder({
                userId: data.assignedUserId,
                customerName: data.assignedUserName || '',
                customerPhone: (await getUserById(data.assignedUserId))?.phone || '',
                operationDate: new Date().toISOString(),
                sellingPriceLYD: updatedTempOrder.totalAmount,
                downPaymentLYD: downPayment,
                status: 'pending',
                itemDescription: `فاتورة مجمعة: ${updatedTempOrder.invoiceName}`,
                productLinks: updatedTempOrder.subOrders.map(so => so.productLinks).join('\\n'),
                exchangeRate: (await getAppSettings()).exchangeRate,
                trackingId: '', // Will be auto-generated
                remainingAmount: updatedTempOrder.remainingAmount,
            });

            if (mainOrder) {
                await updateDoc(orderRef, { parentInvoiceId: mainOrder.id });
                usersToUpdate.add(mainOrder.userId);
            }
        }

        for (const userId of usersToUpdate) {
            if (userId) await recalculateUserStats(userId);
        }

        return true;
    } catch (error) {
        console.error("Error updating temp order:", error);
        return false;
    }
}

export async function deleteTempOrder(orderId: string): Promise<boolean> {
    try {
        const orderRef = doc(db, TEMP_ORDERS_COLLECTION, orderId);

        const docSnap = await getDoc(orderRef);
        if (!docSnap.exists()) {
            throw new Error("TempOrder to delete not found");
        }
        const data = docSnap.data() as TempOrder;

        let userIdToRecalculate: string | null = data.assignedUserId || null;

        if (data.parentInvoiceId) {
            const mainOrderDoc = await getOrderById(data.parentInvoiceId);
            if (mainOrderDoc) {
                userIdToRecalculate = mainOrderDoc.userId;
            }
            await deleteOrder(data.parentInvoiceId);
        }

        await deleteDoc(orderRef);

        if (userIdToRecalculate) {
            await recalculateUserStats(userIdToRecalculate);
        }

        return true;
    } catch (error) {
        console.error("Error deleting temp order:", error);
        return false;
    }
}


// --- Transaction Actions ---

export async function addTransaction(transactionData: Omit<Transaction, 'id'>): Promise<string | null> {
    try {
        const newTransactionRef = await runTransaction(db, async (transaction) => {
            const newDocRef = doc(collection(db, TRANSACTIONS_COLLECTION));

            if (transactionData.type === 'payment' && transactionData.orderId) {
                const orderRef = doc(db, ORDERS_COLLECTION, transactionData.orderId);
                const orderDoc = await transaction.get(orderRef);
                if (orderDoc.exists()) {
                    const newRemaining = (orderDoc.data().remainingAmount || 0) - transactionData.amount;
                    transaction.update(orderRef, { remainingAmount: newRemaining < 0 ? 0 : newRemaining });
                } else {
                    console.log(`Order ${transactionData.orderId} not found while adding payment. It might be a TempOrder.`);
                }
            }

            transaction.set(newDocRef, transactionData);
            return newDocRef;
        });

        if (transactionData.customerId && !transactionData.customerId.startsWith('TEMP-')) {
            await recalculateUserStats(transactionData.customerId);
        }

        return newTransactionRef.id;
    } catch (error) {
        console.error("Error in addTransaction:", error);
        return null;
    }
}

export async function addTempOrderPayment(tempOrderId: string, subOrderId: string, amount: number, notes?: string): Promise<boolean> {
    try {
        const tempOrderRef = doc(db, TEMP_ORDERS_COLLECTION, tempOrderId);

        // This transaction updates the TempOrder and the main Order atomically
        await runTransaction(db, async (transaction) => {
            const tempOrderDoc = await transaction.get(tempOrderRef);
            if (!tempOrderDoc.exists()) {
                throw new Error("TempOrder not found!");
            }
            const tempOrderData = tempOrderDoc.data() as TempOrder;

            const subOrderIndex = tempOrderData.subOrders.findIndex(so => so.subOrderId === subOrderId);
            if (subOrderIndex === -1) {
                throw new Error("SubOrder not found!");
            }

            const newSubOrders = [...tempOrderData.subOrders];
            const currentSubOrderRemaining = newSubOrders[subOrderIndex].remainingAmount || 0;
            newSubOrders[subOrderIndex].remainingAmount = Math.max(0, currentSubOrderRemaining - amount);

            const newTotalRemaining = (tempOrderData.remainingAmount || 0) - amount;

            transaction.update(tempOrderRef, {
                subOrders: newSubOrders,
                remainingAmount: Math.max(0, newTotalRemaining)
            });

            if (tempOrderData.parentInvoiceId) {
                const mainOrderRef = doc(db, ORDERS_COLLECTION, tempOrderData.parentInvoiceId);
                transaction.update(mainOrderRef, {
                    remainingAmount: increment(-amount)
                });
            }
        });

        // After the transaction is successful, create the transaction log and recalculate stats
        const finalTempOrderSnap = await getDoc(tempOrderRef);
        if (!finalTempOrderSnap.exists()) {
            throw new Error("Could not retrieve TempOrder after update.");
        }
        const finalTempOrderData = finalTempOrderSnap.data() as TempOrder;
        const subOrder = finalTempOrderData.subOrders.find(so => so.subOrderId === subOrderId);

        let description = `دفعة من ${subOrder?.customerName || 'عميل'} (فاتورة مجمعة #${tempOrderId.slice(-6)})`;
        if (notes) {
            description += ` | ${notes}`;
        }

        await addDoc(collection(db, TRANSACTIONS_COLLECTION), {
            orderId: finalTempOrderData.parentInvoiceId || tempOrderId,
            customerId: finalTempOrderData.assignedUserId || `TEMP-${subOrderId}`,
            customerName: subOrder?.customerName || 'عميل',
            date: new Date().toISOString(),
            type: 'payment',
            status: 'paid',
            amount: amount,
            description: description
        });

        if (finalTempOrderData.assignedUserId) {
            await recalculateUserStats(finalTempOrderData.assignedUserId);
        }

        return true;
    } catch (error) {
        console.error("Error processing temp order payment transaction:", error);
        return false;
    }
}



export async function getTransactions(): Promise<Transaction[]> {
    try {
        const querySnapshot = await getDocs(collection(db, TRANSACTIONS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
    } catch (error) {
        console.error("Error getting transactions:", error);
        return [];
    }
}

export async function getTransactionsByOrderId(orderId: string): Promise<Transaction[]> {
    try {
        const q = query(collection(db, TRANSACTIONS_COLLECTION), where("orderId", "==", orderId));
        const querySnapshot = await getDocs(q);
        const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
        return transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } catch (error) {
        console.error("Error getting transactions for order:", error);
        return [];
    }
}

export async function getTransactionsByUserId(userId: string): Promise<Transaction[]> {
    try {
        // Find TempOrders assigned to this user to get their sub-order IDs for transaction lookup
        const tempOrdersQuery = query(collection(db, TEMP_ORDERS_COLLECTION), where("assignedUserId", "==", userId));
        const tempOrdersSnapshot = await getDocs(tempOrdersQuery);

        const tempSubOrderCustomerIds = tempOrdersSnapshot.docs.flatMap(doc =>
            (doc.data() as TempOrder).subOrders.map(so => `TEMP-${so.subOrderId}`)
        );

        let customerIdClauses: any[] = [where("customerId", "==", userId)];

        // Firestore 'in' query has a limit of 30 values per query.
        if (tempSubOrderCustomerIds.length > 0) {
            const chunkSize = 30;
            for (let i = 0; i < tempSubOrderCustomerIds.length; i += chunkSize) {
                const chunk = tempSubOrderCustomerIds.slice(i, i + chunkSize);
                customerIdClauses.push(where("customerId", "in", chunk));
            }
        }

        const q = query(collection(db, TRANSACTIONS_COLLECTION), or(...customerIdClauses));

        const querySnapshot = await getDocs(q);
        const transactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
        return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
        console.error(`Error getting transactions for user ${userId}:`, error);
        return [];
    }
}

export async function updateTransaction(transactionId: string, newAmount: number): Promise<boolean> {
    const transactionRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);

    try {
        await runTransaction(db, async (transaction) => {
            const txDoc = await transaction.get(transactionRef);
            if (!txDoc.exists()) {
                throw new Error("Transaction not found!");
            }

            const txData = txDoc.data() as Transaction;
            const oldAmount = txData.amount;
            const amountDifference = newAmount - oldAmount; // If new is smaller, diff is negative

            transaction.update(transactionRef, { amount: newAmount });

            if (txData.orderId) {
                const orderRef = doc(db, ORDERS_COLLECTION, txData.orderId);
                transaction.update(orderRef, { remainingAmount: increment(-amountDifference) });
            }
        });

        const finalTxDoc = await getDoc(transactionRef);
        if (finalTxDoc.exists()) {
            const userId = finalTxDoc.data().customerId;
            if (userId && !userId.startsWith('TEMP-')) {
                await recalculateUserStats(userId);
            }
        }

        return true;
    } catch (error) {
        console.error("Error updating transaction:", error);
        return false;
    }
}


export async function deleteTransaction(transactionId: string): Promise<boolean> {
    const transactionRef = doc(db, TRANSACTIONS_COLLECTION, transactionId);

    try {
        const txDoc = await getDoc(transactionRef);
        if (!txDoc.exists()) {
            throw new Error("Transaction to delete not found");
        }

        const txData = txDoc.data() as Transaction;
        const amountToReturn = txData.amount;
        const orderId = txData.orderId;
        const userId = txData.customerId;

        const batch = writeBatch(db);

        if (orderId) {
            const orderRef = doc(db, ORDERS_COLLECTION, orderId);
            batch.update(orderRef, { remainingAmount: increment(amountToReturn) });
        }

        batch.delete(transactionRef);

        await batch.commit();

        if (userId && !userId.startsWith('TEMP-')) {
            await recalculateUserStats(userId);
        }

        return true;
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return false;
    }
}

export async function resetFinancialReports(): Promise<boolean> {
    try {
        const collectionsToReset = [TRANSACTIONS_COLLECTION, EXPENSES_COLLECTION];
        const MAX_BATCH_SIZE = 500;

        for (const collectionName of collectionsToReset) {
            let lastVisible: DocumentSnapshot | null = null;
            let hasMore = true;

            while (hasMore) {
                let q = query(collection(db, collectionName));
                if (lastVisible) {
                    q = query(collection(db, collectionName));
                }
                const querySnapshot = await getDocs(q);

                if (querySnapshot.empty) {
                    hasMore = false;
                    continue;
                }

                lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
                let batch = writeBatch(db);
                let count = 0;
                for (const doc of querySnapshot.docs) {
                    batch.delete(doc.ref);
                    count++;
                    if (count === MAX_BATCH_SIZE) {
                        await batch.commit();
                        batch = writeBatch(db);
                        count = 0;
                    }
                }
                if (count > 0) {
                    await batch.commit();
                }
                if (querySnapshot.docs.length < MAX_BATCH_SIZE) {
                    hasMore = false;
                }
            }
        }

        const users = await getUsers();
        for (const user of users) {
            await recalculateUserStats(user.id);
        }

        return true;
    } catch (error) {
        console.error("Error resetting financial reports:", error);
        return false;
    }
}

// --- Conversation Actions ---

export async function getAllConversations(): Promise<Conversation[]> {
    try {
        const querySnapshot = await getDocs(collection(db, CONVERSATIONS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Conversation));
    } catch (error) {
        console.error("Error getting all conversations:", error);
        return [];
    }
}


export async function getConversations(): Promise<Conversation[]> {
    try {
        const querySnapshot = await getDocs(collection(db, CONVERSATIONS_COLLECTION));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Conversation));
    } catch (error) {
        console.error("Error getting conversations:", error);
        return [];
    }
}

export async function sendMessage(conversationId: string, message: Omit<Message, 'id'>): Promise<boolean> {
    try {
        const conversationRef = doc(db, CONVERSATIONS_COLLECTION, conversationId);
        const messageWithId = { ...message, id: new Date().toISOString() + Math.random().toString(36).substr(2, 9) };

        const updateData: any = {
            messages: arrayUnion(messageWithId),
            lastMessage: message.text,
            lastMessageTime: message.timestamp,
        };

        if (message.sender === 'user') {
            updateData.unreadCount = increment(1);
        } else if (message.sender === 'support') {
            updateData.unreadCount = 0;
        }

        await updateDoc(conversationRef, updateData);
        return true;
    } catch (error) {
        console.error("Error sending message:", error);
        return false;
    }
}

export async function startConversation(userId: string, userName: string, userAvatar: string): Promise<string | null> {
    try {
        const initialMessage: Message = {
            id: new Date().toISOString(),
            text: 'مرحباً! كيف يمكننا مساعدتك اليوم؟',
            sender: 'support',
            timestamp: new Date().toISOString(),
        };

        const newConversation: Omit<Conversation, 'id'> = {
            userId,
            userName,
            userAvatar,
            lastMessage: initialMessage.text,
            lastMessageTime: initialMessage.timestamp,
            unreadCount: 1,
            messages: [initialMessage],
        };

        const docRef = await addDoc(collection(db, CONVERSATIONS_COLLECTION), newConversation);
        return docRef.id;
    } catch (error) {
        console.error("Error starting conversation:", error);
        return null;
    }
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, CONVERSATIONS_COLLECTION, conversationId));
        return true;
    } catch (error) {
        console.error("Error deleting conversation:", error);
        return false;
    }
}

// --- Notification Actions ---
export async function sendNotification(message: string, targetType: 'all' | 'specific', userId?: string): Promise<boolean> {
    try {
        const notificationData: Omit<Notification, 'id'> = {
            message,
            target: targetType,
            userId: targetType === 'specific' ? (userId ?? null) : null,
            timestamp: new Date().toISOString(),
            isRead: false
        };

        await addDoc(collection(db, NOTIFICATIONS_COLLECTION), notificationData);
        return true;
    } catch (error) {
        console.error("Error sending notification:", error);
        return false;
    }
}

export async function getNotificationsForUser(userId: string): Promise<Notification[]> {
    try {
        const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);
        const q = query(notificationsRef,
            or(
                where('target', '==', 'all'),
                where('userId', '==', userId)
            )
        );

        const querySnapshot = await getDocs(q);
        const notifications = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));

        return notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    } catch (error) {
        console.error("Error fetching notifications:", error);
        return [];
    }
}

export async function markNotificationsAsReadForUser(notificationIds: string[]): Promise<boolean> {
    try {
        const batch = writeBatch(db);
        notificationIds.forEach(id => {
            const notificationRef = doc(db, NOTIFICATIONS_COLLECTION, id);
            batch.update(notificationRef, { isRead: true });
        });
        await batch.commit();
        return true;
    } catch (error) {
        console.error("Error marking notifications as read:", error);
        return false;
    }
}


// --- Expense Actions ---

export async function getExpenses(): Promise<Expense[]> {
    try {
        const querySnapshot = await getDocs(collection(db, EXPENSES_COLLECTION));
        const expenses = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
        return expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
        console.error("Error getting expenses:", error);
        return [];
    }
}

export async function addExpense(expense: Omit<Expense, 'id'>): Promise<Expense | null> {
    try {
        const docRef = await addDoc(collection(db, EXPENSES_COLLECTION), expense);
        return { id: docRef.id, ...expense };
    } catch (error) {
        console.error("Error adding expense:", error);
        return null;
    }
}

export async function deleteExpense(expenseId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, EXPENSES_COLLECTION, expenseId));
        return true;
    } catch (error) {
        console.error("Error deleting expense:", error);
        return false;
    }
}

// --- Deposit Actions ---

export async function getDeposits(): Promise<Deposit[]> {
    try {
        const querySnapshot = await getDocs(collection(db, DEPOSITS_COLLECTION));
        const deposits = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deposit));
        return deposits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
        console.error("Error getting deposits:", error);
        return [];
    }
}

export async function getDepositById(depositId: string): Promise<Deposit | null> {
    try {
        const depositRef = doc(db, DEPOSITS_COLLECTION, depositId);
        const docSnap = await getDoc(depositRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Deposit;
        }
        return null;
    } catch (error) {
        console.error("Error getting deposit by ID:", error);
        return null;
    }
}


export async function getDepositsByRepresentativeId(repId: string): Promise<Deposit[]> {
    try {
        const q = query(collection(db, DEPOSITS_COLLECTION), where("representativeId", "==", repId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deposit));
    } catch (error) {
        console.error("Error getting deposits for representative:", error);
        return [];
    }
}

export async function getDepositsByUserId(userId: string): Promise<Deposit[]> {
    try {
        const user = await getUserById(userId);
        if (!user || !user.phone) return [];

        const q = query(collection(db, DEPOSITS_COLLECTION), where("customerPhone", "==", user.phone));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deposit));
    } catch (error) {
        console.error("Error getting deposits for user:", error);
        return [];
    }
}

export async function addDeposit(deposit: Omit<Deposit, 'id' | 'receiptNumber' | 'collectedDate'>): Promise<Deposit | null> {
    try {
        const receiptNumber = `DEP-${Date.now().toString().slice(-6)}`;

        // If it's collected by admin, set status to 'collected' immediately and add collectedDate
        const finalDeposit: Omit<Deposit, 'id'> = {
            ...deposit,
            receiptNumber,
            status: deposit.collectedBy === 'admin' ? 'collected' : 'pending',
            collectedDate: deposit.collectedBy === 'admin' ? new Date().toISOString() : null,
        };

        const docRef = await addDoc(collection(db, DEPOSITS_COLLECTION), finalDeposit);
        return { id: docRef.id, ...finalDeposit };
    } catch (error) {
        console.error("Error adding deposit:", error);
        return null;
    }
}

export async function updateDeposit(depositId: string, data: Partial<Deposit>): Promise<boolean> {
    try {
        const depositRef = doc(db, DEPOSITS_COLLECTION, depositId);
        await updateDoc(depositRef, data);
        return true;
    } catch (error) {
        console.error("Error updating deposit:", error);
        return false;
    }
}

export async function updateDepositStatus(depositId: string, status: DepositStatus): Promise<boolean> {
    try {
        const depositRef = doc(db, DEPOSITS_COLLECTION, depositId);
        const updateData: { status: DepositStatus, collectedDate?: string } = { status };

        // If the new status is 'collected', set the collectedDate
        if (status === 'collected') {
            updateData.collectedDate = new Date().toISOString();
        }

        await updateDoc(depositRef, updateData);
        return true;
    } catch (error) {
        console.error("Error updating deposit status:", error);
        return false;
    }
}

export async function deleteDeposit(depositId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, DEPOSITS_COLLECTION, depositId));
        return true;
    } catch (error) {
        console.error("Error deleting deposit:", error);
        return false;
    }
}

// --- Creditor & External Debt Actions ---

async function recalculateCreditorDebt(creditorId: string): Promise<void> {
    try {
        const creditorRef = doc(db, CREDITORS_COLLECTION, creditorId);
        const creditorSnap = await getDoc(creditorRef);
        if (!creditorSnap.exists()) return;

        const debtsQuery = query(collection(db, EXTERNAL_DEBTS_COLLECTION), where('creditorId', '==', creditorId));
        const querySnapshot = await getDocs(debtsQuery);

        const totalDebt = querySnapshot.docs.reduce((sum, doc) => {
            const debt = doc.data() as ExternalDebt;
            return sum + debt.amount;
        }, 0);

        await updateDoc(creditorRef, {
            totalDebt: totalDebt
        });
    } catch (error) {
        console.error(`Error recalculating debt for creditor ${creditorId}:`, error);
    }
}


export async function getCreditors(): Promise<Creditor[]> {
    const querySnapshot = await getDocs(collection(db, CREDITORS_COLLECTION));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Creditor));
}

export async function getCreditorById(creditorId: string): Promise<Creditor | null> {
    const docRef = doc(db, CREDITORS_COLLECTION, creditorId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } as Creditor : null;
}

export async function addCreditor(creditorData: Omit<Creditor, 'id' | 'totalDebt'>, initialBalance: number = 0): Promise<Creditor | null> {
    const creditorWithDefaults = {
        ...creditorData,
        totalDebt: 0,
    };
    const docRef = await addDoc(collection(db, CREDITORS_COLLECTION), creditorWithDefaults);
    const newCreditor = { id: docRef.id, ...creditorWithDefaults };

    if (initialBalance !== 0) {
        await addExternalDebt({
            creditorId: newCreditor.id,
            creditorName: newCreditor.name,
            amount: initialBalance,
            date: new Date().toISOString(),
            status: 'pending',
            notes: 'رصيد افتتاحي',
        });
    } else {
        await recalculateCreditorDebt(newCreditor.id);
    }

    // Fetch the creditor again to get the final state after debt calculation
    return getCreditorById(newCreditor.id);
}


export async function updateCreditor(creditorId: string, data: Partial<Omit<Creditor, 'id' | 'totalDebt'>>): Promise<boolean> {
    await updateDoc(doc(db, CREDITORS_COLLECTION, creditorId), data);
    return true;
}

export async function deleteCreditor(creditorId: string): Promise<boolean> {
    const batch = writeBatch(db);
    const creditorRef = doc(db, CREDITORS_COLLECTION, creditorId);
    batch.delete(creditorRef);

    const debtsQuery = query(collection(db, EXTERNAL_DEBTS_COLLECTION), where('creditorId', '==', creditorId));
    const debtsSnapshot = await getDocs(debtsQuery);
    debtsSnapshot.forEach(doc => batch.delete(doc.ref));

    await batch.commit();
    return true;
}

export async function getAllExternalDebts(): Promise<ExternalDebt[]> {
    try {
        const querySnapshot = await getDocs(collection(db, EXTERNAL_DEBTS_COLLECTION));
        const debts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExternalDebt));
        return debts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
        console.error("Error getting all external debts:", error);
        return [];
    }
}


export async function getExternalDebtsForCreditor(creditorId: string): Promise<ExternalDebt[]> {
    const q = query(collection(db, EXTERNAL_DEBTS_COLLECTION), where("creditorId", "==", creditorId));
    const querySnapshot = await getDocs(q);
    const debts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExternalDebt));
    return debts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function addExternalDebt(debt: Omit<ExternalDebt, 'id'>): Promise<ExternalDebt | null> {
    const docRef = await addDoc(collection(db, EXTERNAL_DEBTS_COLLECTION), debt);
    await recalculateCreditorDebt(debt.creditorId);
    return { id: docRef.id, ...debt };
}

export async function updateExternalDebt(debtId: string, data: Partial<ExternalDebt>): Promise<boolean> {
    const debtRef = doc(db, EXTERNAL_DEBTS_COLLECTION, debtId);
    const docSnap = await getDoc(debtRef);
    if (!docSnap.exists()) return false;

    await updateDoc(debtRef, data);
    await recalculateCreditorDebt(docSnap.data().creditorId);
    return true;
}

export async function deleteExternalDebt(debtId: string): Promise<boolean> {
    const debtRef = doc(db, EXTERNAL_DEBTS_COLLECTION, debtId);
    const docSnap = await getDoc(debtRef);
    if (!docSnap.exists()) return false;

    await deleteDoc(debtRef);
    await recalculateCreditorDebt(docSnap.data().creditorId);
    return true;
}


// --- Manual Shipping Label Actions ---

export async function getManualLabels(): Promise<ManualShippingLabel[]> {
    try {
        const querySnapshot = await getDocs(collection(db, MANUAL_LABELS_COLLECTION));
        const labels = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ManualShippingLabel));
        return labels.sort((a, b) => new Date(b.operationDate).getTime() - new Date(a.operationDate).getTime());
    } catch (error) {
        console.error("Error getting manual labels:", error);
        return [];
    }
}

export async function getManualLabelById(labelId: string): Promise<ManualShippingLabel | null> {
    try {
        const docRef = doc(db, MANUAL_LABELS_COLLECTION, labelId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } as ManualShippingLabel : null;
    } catch (error) {
        console.error("Error getting manual label by ID:", error);
        return null;
    }
}


export async function addManualLabel(labelData: Omit<ManualShippingLabel, 'id'>): Promise<ManualShippingLabel | null> {
    try {
        const docRef = await addDoc(collection(db, MANUAL_LABELS_COLLECTION), labelData);
        return { id: docRef.id, ...labelData };
    } catch (error) {
        console.error("Error adding manual label:", error);
        return null;
    }
}

export async function deleteManualLabel(labelId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, MANUAL_LABELS_COLLECTION, labelId));
        return true;
    } catch (error) {
        console.error("Error deleting manual label:", error);
        return false;
    }
}

// --- Instant Sales Actions ---

export async function getInstantSales(): Promise<InstantSale[]> {
    try {
        const querySnapshot = await getDocs(collection(db, INSTANT_SALES_COLLECTION));
        const sales = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InstantSale));
        return sales.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        console.error("Error getting instant sales:", error);
        return [];
    }
}

export async function addInstantSale(saleData: Omit<InstantSale, 'id'>): Promise<InstantSale | null> {
    try {
        const docRef = await addDoc(collection(db, INSTANT_SALES_COLLECTION), saleData);
        return { id: docRef.id, ...saleData };
    } catch (error) {
        console.error("Error adding instant sale:", error);
        return null;
    }
}

export async function deleteInstantSale(saleId: string): Promise<boolean> {
    try {
        await deleteDoc(doc(db, INSTANT_SALES_COLLECTION, saleId));
        return true;
    } catch (error) {
        console.error("Error deleting instant sale:", error);
        return false;
    }
}



// --- Bulk Import ---
export async function bulkImport(collectionName: string, data: any[]): Promise<{ success: boolean, count: number, error?: string }> {
    try {
        if (!Array.isArray(data) || data.length === 0) {
            return { success: false, count: 0, error: "No data provided or invalid format" };
        }

        // Map collection alias to real table name if needed, though usually they match or we can reuse constants
        const CollectionMap: Record<string, string> = {
            'users': USERS_COLLECTION,
            'orders': ORDERS_COLLECTION,
            'transactions': TRANSACTIONS_COLLECTION,
            'representatives': REPRESENTATIVES_COLLECTION,
            'managers': MANAGERS_COLLECTION,
            'deposits': DEPOSITS_COLLECTION,
            'expenses': EXPENSES_COLLECTION,
            'creditors': CREDITORS_COLLECTION,
            'tempOrders': TEMP_ORDERS_COLLECTION,
            'conversations': CONVERSATIONS_COLLECTION,
            'externalDebts': EXTERNAL_DEBTS_COLLECTION,
            'settings': SETTINGS_COLLECTION,
            'instantSales': INSTANT_SALES_COLLECTION
        };

        const tableName = CollectionMap[collectionName];
        if (!tableName) {
            return { success: false, count: 0, error: `Unknown collection: ${collectionName}` };
        }

        // Perform upsert
        const { error } = await supabase.from(tableName).upsert(data);

        if (error) {
            console.error("Bulk import error:", error);
            return { success: false, count: 0, error: error.message };
        }

        return { success: true, count: data.length };
    } catch (e: any) {
        console.error("Bulk import exception:", e);
        return { success: false, count: 0, error: e.message };
    }
}
