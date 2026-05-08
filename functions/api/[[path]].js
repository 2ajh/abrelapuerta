export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Build worker URL
  const targetPath = url.pathname.replace('/api', '');
  const targetUrl  = env.WORKER_URL + targetPath + url.search;

  // Forward petition to worker
  const newRequest = new Request(targetUrl, {
    method:  request.method,
    headers: request.headers,
    body:    request.method !== 'GET' && request.method !== 'HEAD' 
             ? request.body 
             : undefined,
  });

  return fetch(newRequest);
}
