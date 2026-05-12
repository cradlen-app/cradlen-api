# `infrastructure/sms/`

Reserved for the SMS provider wrapper (Twilio, Vonage, etc.) used by reminders. Not implemented — no consumer yet.

Expected shape: `SmsService.sendSms(to, body)`. The `SmsModule` should be `@Global()`.
