/**
 * 进程内任务队列
 *
 * 替代 Cloudflare Queue，在 Electron 主进程内管理后台任务。
 * 支持顺序执行、并发控制、重试。
 */

import { EventEmitter } from 'node:events';

export interface QueueMessage<T = any> {
  body: T;
  ack(): void;
  retry(): void;
}

export interface MessageBatch<T = any> {
  messages: QueueMessage<T>[];
}

type QueueHandler<T = any> = (batch: MessageBatch<T>) => Promise<void>;

export class LocalQueue extends EventEmitter {
  private queue: any[] = [];
  private processing = false;
  private handler: QueueHandler | null = null;
  private maxConcurrency = 5;
  private maxRetries = 3;
  private activeCount = 0;

  /**
   * 注册消费者处理函数
   */
  setHandler(handler: QueueHandler): void {
    this.handler = handler;
  }

  /**
   * 发送消息到队列（兼容 Cloudflare Queue.send()）
   */
  async send(body: any): Promise<void> {
    this.queue.push({ body, retries: 0 });
    console.log(`[Queue] 任务已入列: type=${body.taskType || 'chapters'}, id=${body.taskId || 'n/a'}`);
    this.processNext();
  }

  /**
   * 批量发送消息
   */
  async sendBatch(bodies: { body: any }[]): Promise<void> {
    for (const item of bodies) {
      this.queue.push({ body: item.body, retries: 0 });
    }
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (!this.handler) {
      console.warn('[Queue] 无处理函数，任务等待中...');
      return;
    }

    if (this.activeCount >= this.maxConcurrency) return;
    if (this.queue.length === 0) return;

    const item = this.queue.shift()!;
    this.activeCount++;

    const message: QueueMessage = {
      body: item.body,
      ack: () => {
        console.log(`[Queue] 任务完成: type=${item.body.taskType || 'chapters'}`);
      },
      retry: () => {
        if (item.retries < this.maxRetries) {
          item.retries++;
          console.log(`[Queue] 任务重试 (${item.retries}/${this.maxRetries}): type=${item.body.taskType || 'chapters'}`);
          this.queue.push(item);
        } else {
          console.error(`[Queue] 任务已达最大重试次数: type=${item.body.taskType || 'chapters'}`);
        }
      },
    };

    try {
      await this.handler({ messages: [message] });
    } catch (error) {
      console.error('[Queue] 处理任务时出错:', error);
      message.retry();
    } finally {
      this.activeCount--;
      // 处理下一个任务
      if (this.queue.length > 0) {
        // 使用 setImmediate 避免递归堆栈溢出
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * 获取队列状态
   */
  getStatus(): { pending: number; active: number } {
    return {
      pending: this.queue.length,
      active: this.activeCount,
    };
  }
}
