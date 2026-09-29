interface Env {
  DB: D1Database;
  JOBS: Queue<{ type: "tick"; scheduledAt: number }>;
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.JOBS.send({
      type: "tick",
      scheduledAt: controller.scheduledTime,
    });
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    // TODO: Implement idempotent D1-backed job dispatch and feed collection.
    if (batch.messages.length > 0) {
      throw new Error("Queue processing is not implemented yet.");
    }
  },
} satisfies ExportedHandler<Env>;
