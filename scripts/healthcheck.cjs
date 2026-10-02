fetch(`http://127.0.0.1:${process.env.PORT || 4173}/api/health`, { signal: AbortSignal.timeout(4000) })
  .then(response => { if (!response.ok) process.exitCode = 1; })
  .catch(() => { process.exitCode = 1; });
