import http from 'http';
import app from './app';

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] FRONT_ORIGIN=${process.env.FRONT_ORIGIN}`);
  console.log(`[server] DEV_FAKE_AUTH=${process.env.DEV_FAKE_AUTH === '1' ? 'ON' : 'OFF'}`);
});