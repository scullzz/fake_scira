import { createServer } from 'http';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { decompressSync, strFromU8 } from 'fflate';
import { Server } from 'socket.io';

const app = express();
const port = process.env.PORT || 3051;

app.use(express.json());
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

function tryDecodeBuffer(buffer: Uint8Array): string {
  const asText = Buffer.from(buffer).toString('utf-8');
  const lines = asText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  const prefixPattern = /^[a-z0-9]+:/i;

  if (lines.some(line => prefixPattern.test(line))) {
    return asText;
  }

  try {
    const decompressed = decompressSync(buffer);
    return strFromU8(decompressed);
  } catch (e) {
    console.error('Brotli decompression failed:', e);
    throw new Error('Brotli decompression failed');
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.post('/api/proxy', async (req: Request, res: Response) => {
  const { socketId, ...restBody } = req.body;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const upstreamResponse = await fetch('https://scira.ai/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify(restBody),
    });

    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status);
      res.write(
        JSON.stringify({ error: `API Error: ${upstreamResponse.statusText}` }),
      );
      return res.end();
    }

    const chunks: Uint8Array[] = [];
    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      res.write(JSON.stringify({ error: 'Failed to get response stream' }));
      return res.end();
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const fullBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));

    let rawText: string;
    try {
      rawText = tryDecodeBuffer(new Uint8Array(fullBuffer));
    } catch (decodeError: any) {
      res.write(JSON.stringify({ error: decodeError.message }));
      return res.end();
    }

    const lines = rawText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');

    res.write('{"status":"done", "chunks":[');
    let first = true;

    for (const line of lines) {
      await delay(10);
      const sepIdx = line.indexOf(':');
      if (sepIdx === -1) continue;

      const prefix = line.slice(0, sepIdx).trim();
      const rawValue = line.slice(sepIdx + 1).trim();

      let result;
      try {
        const parsedValue = JSON.parse(rawValue);
        result = { prefix, value: parsedValue };
      } catch {
        result = { prefix, value: rawValue };
      }

      io.to(socketId).emit('proxy-chunk', result);

      if (!first) {
        res.write(',');
      }
      first = false;
      res.write(JSON.stringify(result));
    }

    res.write(']}');
    res.end();
  } catch (error: any) {
    res.status(500);
    res.write(JSON.stringify({ error: 'Proxy error: ' + error.message }));
    res.end();
  }
});

httpServer.listen(port, () => {
  console.log(`Socket.IO server listening on port ${port}`);
});
