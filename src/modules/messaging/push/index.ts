import { env } from '@/env';
import { webPushSender } from './web-push';

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body?: string; url?: string };
/** `gone` = the browser dropped the subscription (404/410): delete it. */
export type PushResult = 'sent' | 'gone';

export interface PushSender {
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

/** Development fake: pushes are printed, not sent. */
export const fakePushSender: PushSender = {
  async send(target, message) {
    console.info(`[push:dev] ${target.endpoint.slice(0, 40)}… ${message.title}`);
    return 'sent';
  },
};

export const getPushSender = (): PushSender =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? webPushSender(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.EMAIL_FROM)
    : fakePushSender;
