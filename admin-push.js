/* Public feature configuration is returned only after server-side admin authorization. */
let adminPushRegistration = null;
let adminPushConfig = null;
let pendingAdminInstall = null;
function pushStatus(message) { document.getElementById('admin-push-status').textContent = message; }
function vapidBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
}
async function prepareAdminPush() {
    const button = document.getElementById('admin-push-enable');
    button.disabled = true;
    const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !installed) {
        pushStatus('على آيفون: افتح Safari، مشاركة ← إضافة إلى الشاشة الرئيسية. افتح الأيقونة الجديدة، ثم فعّل الإشعارات.');
        return;
    }
    if (!isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        pushStatus('الإشعارات الخلفية غير مدعومة هنا. على آيفون يلزم iOS 16.4 أو أحدث وتثبيت التطبيق من Safari.');
        return;
    }
    try {
        adminPushRegistration = await navigator.serviceWorker.register('./admin-sw.js', { scope: './' });
        await navigator.serviceWorker.ready;
        const { data, error } = await supabaseClient.functions.invoke('admin-push', { body: { action: 'config' } });
        if (error || !data?.enabled || !data?.publicKey) throw new Error('backend-not-ready');
        adminPushConfig = data;
        const subscription = await adminPushRegistration.pushManager.getSubscription();
        button.textContent = subscription ? 'تحديث تفعيل هذا الجهاز' : 'تفعيل إشعارات هذا الجهاز';
        button.disabled = false;
        document.getElementById('admin-push-disable').disabled = !subscription;
        pushStatus(subscription ? 'اشتراك موجود على هذا الجهاز. جدّد التفعيل لتأكيد ربطه بحسابك.' : 'جاهز للتفعيل بعد موافقتك. التثبيت وحده لا يفعّل الإشعارات.');
    } catch (_) {
        pushStatus('تنبيهات الخلفية لم تتفعل بعد. يلزم إعداد خادم الإرسال وصلاحيات الأدمن أولاً. الصوت يعمل فقط واللوحة مفتوحة.');
    }
}
async function enableAdminPush() {
    if (!adminPushRegistration || !adminPushConfig) return;
    const button = document.getElementById('admin-push-enable');
    button.disabled = true;
    try {
        // subscribe is called directly from the click handler, before any network await.
        let subscription = await adminPushRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(adminPushConfig.publicKey) });
        const { error } = await supabaseClient.functions.invoke('admin-push', { body: { action: 'subscribe', subscription: subscription.toJSON() } });
        if (error) {
            await subscription.unsubscribe();
            throw new Error('تعذر ربط هذا الجهاز بالخادم. حاول مرة أخرى.');
        }
        document.getElementById('admin-push-disable').disabled = false;
        pushStatus('تم ربط هذا الجهاز. وصول التنبيهات يعتمد على الاتصال وإعدادات الإشعارات والتركيز. لم يتم إرسال تنبيه تجريبي.');
    } catch (error) { pushStatus(error.message || 'لم يتم السماح بالإشعارات. راجع إعدادات المتصفح.'); }
    finally { button.disabled = false; }
}
async function disableAdminPush() {
    const subscription = await adminPushRegistration?.pushManager.getSubscription();
    if (!subscription) return;
    const { error } = await supabaseClient.functions.invoke('admin-push', { body: { action: 'unsubscribe', endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
    document.getElementById('admin-push-disable').disabled = true;
    pushStatus(error ? 'تم إيقاف اشتراك المتصفح. تعذر تنظيف السجل على الخادم، حاول عند عودة الاتصال.' : 'تم إيقاف إشعارات هذا الجهاز.');
}
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); pendingAdminInstall = event;
    document.getElementById('admin-install').hidden = false;
});
async function installAdminApp() {
    if (!pendingAdminInstall) return;
    await pendingAdminInstall.prompt(); pendingAdminInstall = null;
    document.getElementById('admin-install').hidden = true;
}
document.getElementById('admin-push-enable').addEventListener('click', enableAdminPush);
document.getElementById('admin-push-disable').addEventListener('click', () => disableAdminPush().catch(() => pushStatus('تعذر إيقاف الاشتراك. حاول عند عودة الاتصال.')));
document.getElementById('admin-install').addEventListener('click', installAdminApp);

// Retry preparation after the companion script loads if the existing session loaded first.
supabaseClient.auth.getSession().then(({data}) => { if (data.session) prepareAdminPush(); });
