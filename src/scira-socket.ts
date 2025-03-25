import { createServer } from 'http';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { Server } from 'socket.io';

const app = express();
const port = process.env.PORT || 3051;

app.use(express.json());
app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

io.on('connection', socket => {
  socket.on('disconnect', () => {
    console.log('Клиент отключился (Socket.IO):', socket.id);
  });
});

app.post('/api/proxy', async (req: Request, res: Response) => {
  try {
    const response = await fetch('https://scira.ai/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Ошибка API: ${response.status} ${response.statusText}`,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return res
        .status(500)
        .json({ error: 'Не удалось получить стриминговый ответ' });
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      io.emit('proxy-chunk', chunk);
    }

    return res.json({ status: 'done' });
  } catch (error: any) {
    console.error('Ошибка запроса:', error);
    return res
      .status(500)
      .json({ error: 'Ошибка проксирования: ' + error.message });
  }
});

httpServer.listen(port, () => {
  console.log(`Socket is running on port: ${port}`);
});
