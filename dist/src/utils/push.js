import webpush from 'web-push';
import { env } from '../config/env.js';
const vapidKeys = env.vapidPublicKey && env.vapidPrivateKey
    ? { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey }
    : webpush.generateVAPIDKeys();
if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    console.warn('VAPID keys are not configured. Generated ephemeral keys for this process; set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Coolify for stable browser push subscriptions.');
}
webpush.setVapidDetails(env.pushSubject, vapidKeys.publicKey, vapidKeys.privateKey);
export function getPushPublicKey() {
    return vapidKeys.publicKey;
}
export async function sendPush(subscription, payload) {
    return webpush.sendNotification(subscription, JSON.stringify(payload));
}
