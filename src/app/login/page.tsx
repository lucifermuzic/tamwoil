'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Ship, Phone, Loader2, ArrowRight, Lock, PhoneCall } from "lucide-react";
import Image from "next/image";
import Link from 'next/link';
import logo from '@/app/assets/logo.png';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from "@/components/ui/use-toast";
import { getUserByPhone } from "@/lib/actions";
import { motion, AnimatePresence } from 'framer-motion';

const Logo = ({ onClick }: { onClick: () => void }) => (
    <motion.div
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-32 h-32 mb-8 cursor-pointer mx-auto"
        onClick={onClick}
    >
        <Image
            src={logo}
            alt="Logo"
            fill
            className="object-contain drop-shadow-2xl"
            priority
        />
    </motion.div>
);

export default function LoginPage() {
    const [logoClickCount, setLogoClickCount] = useState(0);
    const [titleClickCount, setTitleClickCount] = useState(0);
    const router = useRouter();
    const { toast } = useToast();

    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Set the default theme to light when the component mounts
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    }, []);

    useEffect(() => {
        if (logoClickCount === 3) {
            router.push('/admin/login');
        }

        let timer: NodeJS.Timeout;
        if (logoClickCount > 0) {
            timer = setTimeout(() => setLogoClickCount(0), 1500); // Reset after 1.5 seconds
        }

        return () => {
            clearTimeout(timer);
        };
    }, [logoClickCount, router]);

    useEffect(() => {
        if (titleClickCount === 3) {
            router.push('/representative/login');
        }

        let timer: NodeJS.Timeout;
        if (titleClickCount > 0) {
            timer = setTimeout(() => setTitleClickCount(0), 1500); // Reset after 1.5 seconds
        }

        return () => {
            clearTimeout(timer);
        };
    }, [titleClickCount, router]);


    const handleLogoClick = () => {
        setLogoClickCount(prev => prev + 1);
    };

    const handleTitleClick = () => {
        setTitleClickCount(prev => prev + 1);
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone || !password) {
            toast({
                title: "خطأ في الإدخال",
                description: "الرجاء إدخال رقم الهاتف وكلمة المرور.",
                variant: "destructive",
            });
            return;
        }
        setIsLoading(true);
        try {
            const user = await getUserByPhone(phone);

            if (user && user.password === password) {
                toast({
                    title: "تم تسجيل الدخول بنجاح",
                    description: `مرحباً بك، ${user.name}`,
                });
                localStorage.setItem('loggedInUser', JSON.stringify({ id: user.id, type: 'user' }));
                router.push('/dashboard');
            } else {
                toast({
                    title: "فشل تسجيل الدخول",
                    description: "رقم الهاتف أو كلمة المرور غير صحيحة.",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Login error:", error);
            toast({
                title: "خطأ في الخادم",
                description: "حدث خطأ أثناء محاولة تسجيل الدخول. الرجاء المحاولة مرة أخرى.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="flex min-h-screen bg-background text-foreground overflow-hidden">
            {/* Left Panel - Visuals & Branding (Desktop) */}
            <div className="hidden lg:flex w-1/2 bg-sky-950 relative items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1578575437130-527eed3abbec?q=80&w=2940&auto=format&fit=crop')] bg-cover bg-center opacity-20 mix-blend-overlay"></div>
                <div className="absolute inset-0 bg-gradient-to-br from-sky-900/90 to-slate-900/90"></div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="relative z-10 text-center p-12 max-w-lg"
                >
                    <motion.div
                        animate={{
                            y: [0, -10, 0],
                        }}
                        transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                        onClick={handleLogoClick}
                        className="cursor-pointer"
                    >
                        <Image
                            src={logo}
                            alt="Logo"
                            width={200}
                            height={200}
                            className="mx-auto mb-8 drop-shadow-2xl brightness-0 invert"
                        />
                    </motion.div>
                    <h1 className="text-4xl font-bold text-white mb-6">شركة تمويل لخدمات النقل</h1>
                    <p className="text-xl text-sky-100/80 leading-relaxed">
                        شريكك الموثوق في عالم الخدمات اللوجستية. نضمن وصول شحناتك بأمان وسرعة إلى وجهتها.
                    </p>
                    <div className="mt-12 grid grid-cols-2 gap-6">
                        <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                            <Ship className="w-10 h-10 text-sky-300 mx-auto mb-4" />
                            <h3 className="text-white font-semibold">شحن دولي</h3>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                            <Package className="w-10 h-10 text-sky-300 mx-auto mb-4" />
                            <h3 className="text-white font-semibold">توصيل سريع</h3>
                        </div>
                    </div>
                </motion.div>

                {/* Animated Shapes */}
                <motion.div
                    className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/20 rounded-full blur-3xl"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 8, repeat: Infinity }}
                />
                <motion.div
                    className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"
                    animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 8, repeat: Infinity, delay: 4 }}
                />
            </div>

            {/* Right Panel - Login Form */}
            <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 lg:p-12 relative">
                <div className="w-full max-w-md space-y-8">
                    <div className="text-center lg:text-right space-y-2">
                        <div className="lg:hidden flex justify-center mb-6">
                            <Logo onClick={handleLogoClick} />
                        </div>
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 }}
                        >
                            <h2
                                onClick={handleTitleClick}
                                className="text-3xl font-bold tracking-tight text-slate-900 cursor-pointer select-none"
                            >
                                تسجيل الدخول
                            </h2>
                            <p className="text-slate-500 mt-2">
                                أدخل بياناتك للمتابعة إلى لوحة التحكم
                            </p>
                        </motion.div>
                    </div>

                    <motion.form
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        onSubmit={handleLogin}
                        className="space-y-6"
                    >
                        <div className="space-y-4">
                            <div className="relative group">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-sky-600 transition-colors">
                                    <PhoneCall className="h-5 w-5" />
                                </div>
                                <Input
                                    dir="rtl"
                                    type="text"
                                    placeholder="رقم الهاتف"
                                    className="h-12 pr-10 text-right bg-slate-50 border-slate-200 focus:bg-white focus:border-sky-500 transition-all duration-200"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    disabled={isLoading}
                                />
                            </div>
                            <div className="relative group">
                                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-sky-600 transition-colors">
                                    <Lock className="h-5 w-5" />
                                </div>
                                <Input
                                    dir="rtl"
                                    type="password"
                                    placeholder="كلمة المرور"
                                    className="h-12 pr-10 text-right bg-slate-50 border-slate-200 focus:bg-white focus:border-sky-500 transition-all duration-200"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-12 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl shadow-lg shadow-sky-600/20 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <div className="flex items-center justify-center">
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    <span>جاري التحقق...</span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center gap-2">
                                    <span>دخول آمن</span>
                                    <ArrowRight className="h-4 w-4" />
                                </div>
                            )}
                        </Button>
                    </motion.form>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="pt-8 grid grid-cols-2 gap-4"
                    >
                        <Link href="/dashboard/track-shipment" className="group">
                            <div className="p-4 rounded-xl border border-slate-100 bg-white hover:border-sky-200 hover:shadow-md transition-all duration-300 text-center space-y-2 h-full">
                                <div className="w-10 h-10 bg-sky-50 rounded-full flex items-center justify-center mx-auto group-hover:bg-sky-100 transition-colors">
                                    <Ship className="w-5 h-5 text-sky-600" />
                                </div>
                                <h3 className="font-medium text-slate-700">تتبع شحنتك</h3>
                            </div>
                        </Link>
                        <Link href="/dashboard/calculate-shipment" className="group">
                            <div className="p-4 rounded-xl border border-slate-100 bg-white hover:border-sky-200 hover:shadow-md transition-all duration-300 text-center space-y-2 h-full">
                                <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center mx-auto group-hover:bg-emerald-100 transition-colors">
                                    <Package className="w-5 h-5 text-emerald-600" />
                                </div>
                                <h3 className="font-medium text-slate-700">حساب التكلفة</h3>
                            </div>
                        </Link>
                    </motion.div>

                    <motion.footer
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        className="pt-12 text-center"
                    >
                        <p className="text-sm text-slate-400 mb-2">هل تواجه مشكلة؟</p>
                        <a href="tel:0946691233" className="inline-flex items-center gap-2 text-sky-600 font-semibold hover:text-sky-700 transition-colors bg-sky-50 px-4 py-2 rounded-full">
                            <Phone className="w-4 h-4" />
                            <span dir="ltr">0946 691 233</span>
                        </a>
                    </motion.footer>
                </div>
            </div>
        </div>
    );
}

