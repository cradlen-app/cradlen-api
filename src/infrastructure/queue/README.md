# `infrastructure/queue/`

Reserved for BullMQ wrappers and job processors. Not implemented — no consumer yet.

When introduced, this folder should host the BullMQ connection, a `JobQueue` abstraction, and any base processor classes. Domain-specific processors (e.g. reminder send-out, report generation) belong with their owning core/plugin module and consume the abstraction from here.
