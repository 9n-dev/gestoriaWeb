import webpush, { WebPushError } from 'web-push';
import type { PushSender } from './index';

export const webPushSender = (
  publicKey: string,
  privateKey: string,
  contact: string,
): PushSender => ({
  async send(target, message) {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { vapidDetails: { subject: `mailto:${contact}`, publicKey, privateKey }, TTL: 24 * 3600 },
      );
      return 'sent';
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410))
        return 'gone';
      throw error;
    }
  },
});
