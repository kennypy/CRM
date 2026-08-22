"""
Shared Redis Streams consumer loop.

One implementation of the consumer-group read/ack cycle for every pipeline
worker. Failed messages are parked on a `<stream>:dead-letter` stream (durable,
inspectable) and then acked, so a transient DB error or a poison message is
recoverable rather than lost — and never wedges the consumer group by being
redelivered forever.
"""

import asyncio
import json

import redis.asyncio as aioredis
import structlog

log = structlog.get_logger()


async def consume(
    redis_url: str,
    stream: str,
    group: str,
    consumer: str,
    handler,
    *,
    count: int = 10,
    block: int = 2000,
    field: str = "data",
) -> None:
    """Consume `stream` forever, calling `await handler(payload)` with the
    JSON-decoded value of `field` for each message."""
    redis = aioredis.from_url(redis_url, decode_responses=True)
    try:
        await redis.xgroup_create(stream, group, id="0", mkstream=True)
    except Exception:
        pass  # group already exists
    log.info("worker.started", stream=stream, group=group)

    while True:
        try:
            messages = await redis.xreadgroup(
                groupname=group, consumername=consumer,
                streams={stream: ">"}, count=count, block=block,
            )
            for _, stream_messages in (messages or []):
                for msg_id, fields in stream_messages:
                    try:
                        await handler(json.loads(fields[field]))
                    except Exception as e:
                        log.error("worker.handler_failed", stream=stream, msg_id=msg_id, error=str(e))
                        try:
                            await redis.xadd(
                                f"{stream}:dead-letter",
                                {"data": fields.get(field, ""), "error": str(e), "group": group},
                                maxlen=10000, approximate=True,
                            )
                        except Exception as dlq_err:
                            log.error("worker.dead_letter_failed", stream=stream, error=str(dlq_err))
                    await redis.xack(stream, group, msg_id)
        except Exception as e:
            log.error("worker.loop_error", stream=stream, error=str(e))
            await asyncio.sleep(5)
