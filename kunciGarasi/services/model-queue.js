function createQueue({ capacity = 20, waitMs = 15000 } = {}) {
  const queue = [];
  let running = false;
  function drain() {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift();
    clearTimeout(job.timer);
    Promise.resolve()
      .then(job.action)
      .then(job.resolve, job.reject)
      .finally(() => {
        running = false;
        drain();
      });
  }
  return {
    run(action) {
      if (queue.length >= capacity)
        return Promise.reject(
          Object.assign(Error("Antrean AI penuh. Coba lagi nanti."), {
            status: 429,
          }),
        );
      return new Promise((resolve, reject) => {
        const job = { action, resolve, reject };
        job.timer = setTimeout(() => {
          const index = queue.indexOf(job);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(
              Object.assign(Error("Antrean AI melewati batas tunggu."), {
                status: 429,
              }),
            );
          }
        }, waitMs);
        queue.push(job);
        drain();
      });
    },
    get size() {
      return queue.length;
    },
  };
}
module.exports = { createQueue, modelQueue: createQueue() };
