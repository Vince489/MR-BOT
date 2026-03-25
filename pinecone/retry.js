// retry.js
async function retry(fn, { maxRetries = 3, initialDelay = 500, backoffFactor = 2, jitter = true } = {}) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (retries === maxRetries - 1) {
        throw error; // Re-throw error if max retries reached
      }

      const delay = initialDelay * (backoffFactor ** retries);
      const randomJitter = jitter ? Math.random() * delay : 0;
      const finalDelay = delay + randomJitter;

      console.warn(`Attempt ${retries + 1} failed. Retrying in ${finalDelay.toFixed(2)}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, finalDelay));
      retries++;
    }
  }
}

export { retry };
