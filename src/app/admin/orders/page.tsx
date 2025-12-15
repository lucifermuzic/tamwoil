
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreHorizontal, PlusCircle, Trash2, Edit, Truck, CheckCircle, Clock, DollarSign, Copy, UserPlus, Search, Package, Building, Plane, MapPin, UserX, Calendar as CalendarIcon, Filter, X, Printer, TrendingUp, Scale } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/components/ui/use-toast";
import { Order, OrderStatus, Representative, AppSettings } from '@/lib/types';
import { getOrders, updateOrder, deleteOrder, addTransaction, getRepresentatives, assignRepresentativeToOrder, unassignRepresentativeFromOrder, bulkDeleteOrders, bulkUpdateOrdersStatus, getAppSettings, setCustomerWeightDetails } from '@/lib/actions';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Textarea } from '@/components/ui/textarea';


const statusConfig: { [key in OrderStatus]: { text: string; icon: React.ReactNode; className: string } } = {
  pending: { text: 'قيد التجهيز', icon: <Clock className="w-4 h-4" />, className: 'bg-yellow-100 text-yellow-700' },
  processed: { text: 'تم التنفيذ', icon: <CheckCircle className="w-4 h-4" />, className: 'bg-cyan-100 text-cyan-700' },
  ready: { text: 'تم التجهيز', icon: <Package className="w-4 h-4" />, className: 'bg-indigo-100 text-indigo-700' },
  shipped: { text: 'تم الشحن', icon: <Truck className="w-4 h-4" />, className: 'bg-blue-100 text-blue-700' },
  arrived_dubai: { text: 'وصلت إلى دبي', icon: <Plane className="w-4 h-4" />, className: 'bg-orange-100 text-orange-700' },
  arrived_benghazi: { text: 'وصلت إلى بنغازي', icon: <Building className="w-4 h-4" />, className: 'bg-teal-100 text-teal-700' },
  arrived_tobruk: { text: 'وصلت إلى طبرق', icon: <Building className="w-4 h-4" />, className: 'bg-purple-100 text-purple-700' },
  out_for_delivery: { text: 'مع المندوب', icon: <MapPin className="w-4 h-4" />, className: 'bg-lime-100 text-lime-700' },
  delivered: { text: 'تم التسليم', icon: <CheckCircle className="w-4 h-4" />, className: 'bg-green-100 text-green-700' },
  cancelled: { text: 'ملغي', icon: <Trash2 className="w-4 h-4" />, className: 'bg-red-100 text-red-700' },
  paid: { text: 'مدفوع', icon: <CheckCircle className="w-4 h-4" />, className: 'bg-green-100 text-green-700' },
};

const allStatuses = Object.keys(statusConfig) as OrderStatus[];

import { motion, AnimatePresence } from 'framer-motion';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariant = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

const AdminOrdersPage = () => {
  const router = useRouter();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [representatives, setRepresentatives] = useState<Representative[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isWeightDialogOpen, setIsWeightDialogOpen] = useState(false);

  // Data for dialogs
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [weightKg, setWeightKg] = useState(0);
  const [companyKiloPriceUSD, setCompanyKiloPriceUSD] = useState(0); // Company cost per kilo in USD
  const [customerKiloPrice, setCustomerKiloPrice] = useState(0); // Customer price per kilo in LYD

  // Filtering states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Bulk actions states
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const selectedRowCount = useMemo(() => Object.values(selectedRows).filter(Boolean).length, [selectedRows]);


  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedOrders, fetchedReps, fetchedSettings] = await Promise.all([
        getOrders(),
        getRepresentatives(),
        getAppSettings()
      ]);
      setOrders(fetchedOrders.sort((a, b) => new Date(b.operationDate).getTime() - new Date(a.operationDate).getTime()));
      setRepresentatives(fetchedReps);
      setSettings(fetchedSettings);
    } catch (error) {
      toast({ title: "خطأ", description: "فشل تحميل البيانات.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const query = searchQuery.toLowerCase();

      // Search filter
      const matchesSearch = (
        order.customerName.toLowerCase().includes(query) ||
        (order.trackingId && order.trackingId.toLowerCase().includes(query)) ||
        (order.invoiceNumber && order.invoiceNumber.toLowerCase().includes(query))
      );

      // Status filter
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

      // Payment filter
      const matchesPayment = paymentFilter === 'all' ||
        (paymentFilter === 'paid' && order.remainingAmount <= 0) ||
        (paymentFilter === 'unpaid' && order.remainingAmount > 0);

      // Date range filter
      const matchesDate = !dateRange?.from || (
        parseISO(order.operationDate) >= startOfDay(dateRange.from) &&
        parseISO(order.operationDate) <= endOfDay(dateRange.to || dateRange.from)
      );

      return matchesSearch && matchesStatus && matchesPayment && matchesDate;
    });
  }, [orders, searchQuery, statusFilter, paymentFilter, dateRange]);

  const { totalValue, totalDebt, totalProfit } = useMemo(() => {
    const activeOrders = filteredOrders.filter(o => o.status !== 'cancelled');
    const value = activeOrders.reduce((sum, order) => sum + order.sellingPriceLYD, 0);
    const debt = activeOrders.reduce((sum, order) => sum + order.remainingAmount, 0);
    const profit = activeOrders.reduce((sum, order) => {
      const purchaseCostLYD = (order.purchasePriceUSD || 0) * (order.exchangeRate || settings?.exchangeRate || 1);
      const shippingCostLYD = order.shippingCostLYD || 0;
      // Company weight cost stored in USD, convert to LYD using order's exchange rate (or current if not set)
      const weightCostUSD = order.companyWeightCostUSD || 0;
      const weightCostLYD = weightCostUSD * (order.exchangeRate || settings?.exchangeRate || 1);

      // Legacy support: if companyWeightCost (LYD) exists, add it too (though we deprecated it)
      const legacyWeightCost = order.companyWeightCost || 0;

      const netProfit = order.sellingPriceLYD - purchaseCostLYD - shippingCostLYD - weightCostLYD - legacyWeightCost;
      return sum + netProfit;
    }, 0);

    return { totalValue: value, totalDebt: debt, totalProfit: profit };
  }, [filteredOrders, settings]);


  const handleSelectRow = (orderId: string, checked: boolean) => {
    setSelectedRows(prev => ({ ...prev, [orderId]: checked }));
  };

  const handleSelectAll = (checked: boolean) => {
    const newSelectedRows: Record<string, boolean> = {};
    if (checked) {
      filteredOrders.forEach(order => {
        newSelectedRows[order.id] = true;
      });
    }
    setSelectedRows(newSelectedRows);
  };

  // --- Single Action Handlers ---
  const openPaymentDialog = (order: Order) => {
    setCurrentOrder(order);
    setPaymentAmount(0);
    setPaymentNotes('');
    setIsPaymentDialogOpen(true);
  };

  const openDeleteConfirm = (order: Order) => {
    setCurrentOrder(order);
    setIsDeleteConfirmOpen(true);
  };

  const openWeightDialog = (order: Order) => {
    setCurrentOrder(order);
    setWeightKg(0);
    setCompanyKiloPriceUSD(0);
    setCustomerKiloPrice(0);
    setIsWeightDialogOpen(true);
  };

  const handleUpdateStatus = async (orderId: string, status: OrderStatus) => {
    try {
      await updateOrder(orderId, { status });
      setOrders(prevOrders => prevOrders.map(o => o.id === orderId ? { ...o, status } : o));
      toast({ title: "تم تحديث الحالة بنجاح" });
    } catch (error) {
      toast({ title: "خطأ", description: "فشل تحديث الحالة", variant: "destructive" });
    }
  };

  const handleAddPayment = async () => {
    if (!currentOrder || paymentAmount <= 0) return;

    let description = `دفعة من طلب ${currentOrder.invoiceNumber}`;
    if (paymentNotes) {
      description += ` | ${paymentNotes}`;
    }

    await addTransaction({
      orderId: currentOrder.id,
      customerId: currentOrder.userId,
      customerName: currentOrder.customerName,
      date: new Date().toISOString(),
      type: 'payment',
      status: 'paid',
      amount: paymentAmount,
      description: description,
    });
    toast({ title: "تم تسجيل الدفعة بنجاح" });
    setIsPaymentDialogOpen(false);
    setCurrentOrder(null);
    fetchData();
  };

  const handleDeleteOrder = async () => {
    if (currentOrder) {
      const success = await deleteOrder(currentOrder.id);
      if (success) {
        setOrders(prevOrders => prevOrders.filter(o => o.id !== currentOrder.id));
        toast({ title: "تم حذف الطلب" });
      } else {
        toast({ title: "خطأ", description: "فشل حذف الطلب. يرجى مراجعة السجلات.", variant: "destructive" });
      }
    }
    setIsDeleteConfirmOpen(false);
    setCurrentOrder(null);
  };

  const handleAssignRep = async (orderId: string, rep: Representative) => {
    await assignRepresentativeToOrder(orderId, rep);
    toast({ title: "تم إسناد المندوب وتغيير الحالة إلى 'مع المندوب'" });
    fetchData(); // Refetch data to show updated status
  }

  const handleUnassignRep = async (orderId: string) => {
    await unassignRepresentativeFromOrder(orderId);
    toast({ title: "تم إلغاء إسناد المندوب وإرجاع الحالة إلى 'تم التجهيز'" });
    fetchData(); // Refetch data
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "تم النسخ!", description: `تم نسخ ${label} إلى الحافظة.` });
    });
  };

  const handlePrint = (order: Order) => {
    window.open(`/admin/orders/${order.id}/print`, '_blank', 'height=842,width=595,resizable=yes,scrollbars=yes');
  };

  const handleAddWeightCost = async () => {
    if (!currentOrder || weightKg <= 0) return;

    try {
      await setCustomerWeightDetails(currentOrder.id, weightKg, companyKiloPriceUSD, customerKiloPrice);

      const customerTotalLYD = weightKg * customerKiloPrice;
      const companyTotalUSD = weightKg * companyKiloPriceUSD;

      setOrders(prev => prev.map(o => {
        if (o.id === currentOrder.id) {
          return {
            ...o,
            sellingPriceLYD: o.sellingPriceLYD + customerTotalLYD,
            remainingAmount: o.remainingAmount + customerTotalLYD,
            customerWeightCost: (o.customerWeightCost || 0) + customerTotalLYD,
            companyWeightCostUSD: (o.companyWeightCostUSD || 0) + companyTotalUSD,
            weightKG: weightKg,
            companyPricePerKiloUSD: companyKiloPriceUSD,
            customerPricePerKilo: customerKiloPrice
          };
        }
        return o;
      }));
      toast({ title: "تم إضافة تفاصيل الوزن بنجاح" });
      setIsWeightDialogOpen(false);
      setCurrentOrder(null);
    } catch (error) {
      toast({ title: "خطأ", description: "فشل إضافة القيمة", variant: "destructive" });
    }
  };

  // --- Bulk Action Handlers ---
  const handleBulkDelete = async () => {
    const idsToDelete = Object.keys(selectedRows).filter(id => selectedRows[id]);
    if (idsToDelete.length === 0) return;
    const success = await bulkDeleteOrders(idsToDelete);
    if (success) {
      toast({ title: `تم حذف ${idsToDelete.length} طلب بنجاح` });
      fetchData();
      setSelectedRows({});
    } else {
      toast({ title: "خطأ", description: "فشل حذف بعض الطلبات.", variant: "destructive" });
    }
    setIsBulkDeleteOpen(false);
  }

  const handleBulkUpdateStatus = async (status: OrderStatus) => {
    const idsToUpdate = Object.keys(selectedRows).filter(id => selectedRows[id]);
    if (idsToUpdate.length === 0) return;
    const success = await bulkUpdateOrdersStatus(idsToUpdate, status);
    if (success) {
      toast({ title: `تم تحديث حالة ${idsToUpdate.length} طلب بنجاح` });
      fetchData();
      setSelectedRows({});
    } else {
      toast({ title: "خطأ", description: "فشل تحديث حالة بعض الطلبات.", variant: "destructive" });
    }
  }

  const handleBulkAssignRep = async (rep: Representative) => {
    const idsToUpdate = Object.keys(selectedRows).filter(id => selectedRows[id]);
    if (idsToUpdate.length === 0) return;
    // This is not implemented in actions.ts yet
    toast({ title: "قيد التطوير", description: "الإسناد الجماعي للمندوبين قيد التطوير.", variant: "default" });
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="p-4 sm:p-6"
      dir="rtl"
    >
      <div className="flex items-center justify-between mb-6">
        <motion.h1 variants={itemVariant} className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">إدارة الطلبات</motion.h1>
        <motion.div variants={itemVariant}>
          <Button size="sm" className="gap-1 shadow-lg hover:shadow-primary/50 transition-shadow" onClick={() => router.push('/admin/orders/add')}>
            <PlusCircle className="h-4 w-4" />
            إضافة طلب جديد
          </Button>
        </motion.div>
      </div>

      <motion.div variants={itemVariant} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="glass-card border-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي قيمة الطلبات</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-800 dark:text-white">{totalValue.toFixed(2)} د.ل</div>
            <p className="text-xs text-muted-foreground">مجموع كل الطلبات (غير الملغية) المعروضة</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الديون</CardTitle>
            <DollarSign className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{totalDebt.toFixed(2)} د.ل</div>
            <p className="text-xs text-muted-foreground">مجموع الديون المتبقية للطلبات المعروضة</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي صافي الأرباح</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {totalProfit.toFixed(2)} د.ل
            </div>
            <p className="text-xs text-muted-foreground">مجموع أرباح الطلبات المعروضة</p>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariant}>
        <Card className="glass-card border-none">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <CardTitle>قائمة الطلبات</CardTitle>
              <div className="relative w-full sm:w-72">
                <Input
                  placeholder="ابحث بالاسم، كود التتبع، أو رقم الفاتورة..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10 bg-white/50 dark:bg-black/20"
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
              </div>
            </div>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 pt-4 items-center">
              <Filter className="w-5 h-5 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px] bg-white/50 dark:bg-black/20">
                  <SelectValue placeholder="فلترة بالحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {allStatuses.map(s => <SelectItem key={s} value={s}>{statusConfig[s].text}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="w-full sm:w-[180px] bg-white/50 dark:bg-black/20">
                  <SelectValue placeholder="فلترة بالدفع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="paid">مدفوع</SelectItem>
                  <SelectItem value="unpaid">غير مدفوع</SelectItem>
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="date"
                    variant={"outline"}
                    className={cn("w-full sm:w-[260px] justify-start text-right font-normal bg-white/50 dark:bg-black/20", dateRange && "text-primary border-primary")}
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        `${format(dateRange.from, "d/M/y")} - ${format(dateRange.to, "d/M/y")}`
                      ) : (format(dateRange.from, "d/M/yy"))
                    ) : (<span>اختر فترة زمنية</span>)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
              {dateRange && (
                <Button variant="ghost" size="icon" onClick={() => setDateRange(undefined)}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {selectedRowCount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-2 p-2 mb-4 bg-primary/10 rounded-lg"
              >
                <span className="text-sm font-semibold text-primary">
                  {selectedRowCount} طلب محدد
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="bg-white/50">الإجراءات الجماعية</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>تحديث الحالة</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {allStatuses.map(s => (
                          <DropdownMenuItem key={s} onSelect={() => handleBulkUpdateStatus(s)}>
                            {statusConfig[s].text}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>إسناد إلى مندوب</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {representatives.map(rep => (
                          <DropdownMenuItem key={rep.id} onSelect={() => handleBulkAssignRep(rep)}>
                            {rep.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setIsBulkDeleteOpen(true)}>حذف المحدد</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </motion.div>
            )}
            <div className="rounded-md border bg-white/50 dark:bg-black/20 backdrop-blur-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-secondary/50">
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={selectedRowCount > 0 && selectedRowCount === filteredOrders.length}
                        onCheckedChange={(checked) => handleSelectAll(!!checked)}
                      />
                    </TableHead>
                    <TableHead className='text-right font-bold'>رقم الفاتورة</TableHead>
                    <TableHead className='text-right font-bold'>كود التتبع</TableHead>
                    <TableHead className='text-right font-bold'>اسم العميل</TableHead>
                    <TableHead className='text-right font-bold'>المندوب</TableHead>
                    <TableHead className='text-right font-bold'>الإجمالي</TableHead>
                    <TableHead className='text-right font-bold'>المتبقي</TableHead>
                    <TableHead className='text-right font-bold'>الحالة</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center h-24">
                      <div className="flex items-center justify-center gap-2">
                        <Package className="w-6 h-6 animate-bounce text-primary" />
                        <span>جاري تحميل الطلبات...</span>
                      </div>
                    </TableCell></TableRow>
                  ) : filteredOrders.map((order, index) => (
                    <motion.tr
                      key={order.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`group hover:bg-muted/50 transition-colors ${selectedRows[order.id] ? "bg-primary/5" : ""}`}
                      data-state={selectedRows[order.id] && "selected"}
                    >
                      <TableCell>
                        <Checkbox
                          checked={!!selectedRows[order.id]}
                          onCheckedChange={(checked) => handleSelectRow(order.id, !!checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-medium hover:underline text-primary">
                          {order.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 font-mono text-sm">
                          <span className="text-muted-foreground">{order.trackingId}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => copyToClipboard(order.trackingId, 'كود التتبع')}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{order.customerName}</TableCell>
                      <TableCell>{order.representativeName ? <Badge variant="secondary" className="font-normal">{order.representativeName}</Badge> : <span className="text-muted-foreground text-sm">--</span>}</TableCell>
                      <TableCell>{order.sellingPriceLYD.toFixed(2)} د.ل</TableCell>
                      <TableCell className={order.remainingAmount > 0 ? 'text-destructive font-bold' : 'text-green-600'}>
                        {order.remainingAmount.toFixed(2)} د.ل
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-normal border-none ${statusConfig[order.status as keyof typeof statusConfig].className}`}>
                          {statusConfig[order.status as keyof typeof statusConfig].icon}
                          <span className="mr-1">{statusConfig[order.status as keyof typeof statusConfig].text}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>الإجراءات</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => router.push(`/admin/orders/add?id=${order.id}`)}>
                              <Edit className="ml-2 h-4 w-4" /> تعديل
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handlePrint(order)}>
                              <Printer className="ml-2 h-4 w-4" /> طباعة البوليصة
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openPaymentDialog(order)} disabled={order.remainingAmount <= 0}>
                              <DollarSign className="ml-2 h-4 w-4" /> دفع جزء من المبلغ
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <Truck className="ml-2 h-4 w-4" /> تحديث الحالة
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {allStatuses.map(s => <DropdownMenuItem key={s} onSelect={() => handleUpdateStatus(order.id, s)}>{statusConfig[s].text}</DropdownMenuItem>)}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <UserPlus className="ml-2 h-4 w-4" /> إسناد إلى مندوب
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem onSelect={() => handleUnassignRep(order.id)}>
                                  <UserX className="ml-2 h-4 w-4" /> إلغاء الإسناد
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {representatives.map(rep => (
                                  <DropdownMenuItem key={rep.id} onSelect={() => handleAssignRep(order.id, rep)}>
                                    {rep.name}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => openDeleteConfirm(order)} className="text-destructive focus:bg-destructive/30 focus:text-destructive-foreground">
                              <Trash2 className="ml-2 h-4 w-4" /> حذف
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => openWeightDialog(order)}>
                              <Scale className="ml-2 h-4 w-4" /> وزن الزبون
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent dir='rtl'>
          <DialogHeader>
            <DialogTitle>تسجيل دفعة جديدة للطلب {currentOrder?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              المبلغ المتبقي الحالي: {currentOrder?.remainingAmount.toFixed(2)} د.ل
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="payment-amount">قيمة الدفعة (د.ل)</Label>
              <Input
                id="payment-amount"
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-notes">ملاحظات (اختياري)</Label>
              <Textarea
                id="payment-notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="مثال: دفعة عن طريق الحساب البنكي..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddPayment}>حفظ الدفعة</Button>
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent dir='rtl'>
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من رغبتك في حذف الطلب "{currentOrder?.invoiceNumber}"؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDeleteOrder}>حذف</Button>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent dir='rtl'>
          <DialogHeader>
            <DialogTitle>تأكيد الحذف الجماعي</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من رغبتك في حذف {selectedRowCount} طلب؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={handleBulkDelete}>نعم، قم بحذف الكل</Button>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Weight Cost Dialog */}
      <Dialog open={isWeightDialogOpen} onOpenChange={setIsWeightDialogOpen}>
        <DialogContent dir='rtl'>
          <DialogHeader>
            <DialogTitle>إضافة تفاصيل الوزن - {currentOrder?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              أدخل الوزن وتكلفة الكيلو (على الشركة) وسعر بيع الكيلو (للزبون).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="weight-kg">الوزن (كجم)</Label>
              <Input
                id="weight-kg"
                type="number"
                value={weightKg}
                onChange={(e) => setWeightKg(parseFloat(e.target.value) || 0)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-price">تكلفة الكيلو على الشركة ($ دولار)</Label>
              <Input
                id="company-price"
                type="number"
                value={companyKiloPriceUSD}
                onChange={(e) => setCompanyKiloPriceUSD(parseFloat(e.target.value) || 0)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-price">سعر بيع الكيلو للزبون (د.ل)</Label>
              <Input
                id="customer-price"
                type="number"
                value={customerKiloPrice}
                onChange={(e) => setCustomerKiloPrice(parseFloat(e.target.value) || 0)}
                dir="ltr"
              />
            </div>
            <div className="bg-muted p-3 rounded-md text-sm space-y-1">
              {(() => {
                const companyTotalUSD = weightKg * companyKiloPriceUSD;
                const exchangeRate = currentOrder?.exchangeRate || settings?.exchangeRate || 1;
                const companyTotalLYD = companyTotalUSD * exchangeRate;
                const customerTotalLYD = weightKg * customerKiloPrice;
                const profit = customerTotalLYD - companyTotalLYD;

                return (
                  <>
                    <div className="flex justify-between">
                      <span>التكلفة (شركة - $):</span>
                      <span className="font-bold">{companyTotalUSD.toFixed(2)} $</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>(سعر الصرف: {exchangeRate})</span>
                      <span>~ {companyTotalLYD.toFixed(2)} د.ل</span>
                    </div>
                    <div className="flex justify-between">
                      <span>إجمالي البيع (زبون):</span>
                      <span className="font-bold text-green-600">{customerTotalLYD.toFixed(2)} د.ل</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t mt-1">
                      <span>تقدير الربح:</span>
                      <span className={`font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {profit.toFixed(2)} د.ل
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddWeightCost}>حفظ وإضافة</Button>
            <Button variant="outline" onClick={() => setIsWeightDialogOpen(false)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default AdminOrdersPage;
