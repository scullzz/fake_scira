import http from 'http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

import {
  deepResearch,
  writeFinalAnswer,
  writeFinalReport,
} from './deep-research';
import { generateFeedback } from './feedback';

interface SocketSession {
  query: string;
  isReport: boolean;
  breadth: number;
  depth: number;
  followUpQuestions: string[];
  currentQuestionIndex: number;
  answers: string[];
  sources: string[];
}

const sessions = new Map<string, SocketSession>();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    sessions.delete(socket.id);
  });

  socket.on('startResearch', async payload => {
    try {
      const { query, isReport = true, breadth = 3, depth = 2 } = payload || {};

      if (!query) {
        socket.emit('serverError', { error: 'No query provided' });
        return;
      }

      const followUpQuestions = await generateFeedback({
        query,
        numQuestions: 3,
      });

      sessions.set(socket.id, {
        query,
        isReport,
        breadth,
        depth,
        followUpQuestions,
        currentQuestionIndex: 0,
        answers: [],
        sources: [],
      });

      if (followUpQuestions.length === 0) {
        socket.emit('serverMessage', {
          message: 'No follow-up questions needed, proceeding to research...',
        });
        await doFinalResearch(socket);
        return;
      }

      socket.emit('serverQuestion', {
        question: followUpQuestions[0],
        index: 0,
        total: followUpQuestions.length,
      });
    } catch (err) {
      console.error('startResearch error:', err);
      socket.emit('serverError', { error: String(err) });
    }
  });

  socket.on('clientAnswer', async payload => {
    try {
      const { answer } = payload || {};
      const session = sessions.get(socket.id);
      if (!session) {
        socket.emit('serverError', {
          error: 'No active session. Call startResearch first.',
        });
        return;
      }
      if (typeof answer !== 'string') {
        socket.emit('serverError', { error: 'Answer must be a string' });
        return;
      }

      session.answers[session.currentQuestionIndex] = answer;

      session.currentQuestionIndex++;
      sessions.set(socket.id, session);

      if (session.currentQuestionIndex < session.followUpQuestions.length) {
        const nextIndex = session.currentQuestionIndex;
        socket.emit('serverQuestion', {
          question: session.followUpQuestions[nextIndex],
          index: nextIndex,
          total: session.followUpQuestions.length,
        });
      } else {
        socket.emit('serverMessage', {
          message:
            'All follow-up questions answered. Starting deep research...',
        });
        await doFinalResearch(socket);
      }
    } catch (err) {
      console.error('clientAnswer error:', err);
      socket.emit('serverError', { error: String(err) });
    }
  });
});

async function doFinalResearch(socket: any) {
  const session = sessions.get(socket.id);
  if (!session) {
    socket.emit('serverError', {
      error: 'No active session in doFinalResearch',
    });
    return;
  }

  const { query, isReport, breadth, depth, followUpQuestions, answers } =
    session;

  let combinedQuery = query;
  if (followUpQuestions.length > 0) {
    combinedQuery = `
Initial Query: ${query}
Follow-up Questions and Answers:
${followUpQuestions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? ''}`).join('\n')}
`.trim();
  }

  try {
    socket.emit('serverMessage', { message: 'Starting deepResearch...' });
    const { learnings, visitedUrls, sources } = await deepResearch({
      query: combinedQuery,
      breadth,
      depth,
      onProgress: prog => {
        // В процессе добавляем и источник
        socket.emit('researchProgress', {
          ...prog,
          sources: prog.sources || [],
        });
      },
    });

    // Обновляем источники
    session.sources.push(...sources);
    sessions.set(socket.id, session);

    if (isReport) {
      const report = await writeFinalReport({
        prompt: combinedQuery,
        learnings,
        visitedUrls,
      });
      socket.emit('serverFinal', {
        type: 'report',
        report,
        learnings,
        visitedUrls,
        sources: session.sources,
      });
    } else {
      const answer = await writeFinalAnswer({
        prompt: combinedQuery,
        learnings,
      });
      socket.emit('serverFinal', {
        type: 'answer',
        answer,
        learnings,
        visitedUrls,
        sources: session.sources,
      });
    }

    sessions.delete(socket.id);
  } catch (err) {
    console.error('doFinalResearch error:', err);
    socket.emit('serverError', { error: String(err) });
  }
}

app.get('/', (_, res) => {
  res.send('Socket-based deep-research server is up!');
});

const PORT = process.env.PORT || 3051;
server.listen(PORT, () => {
  console.log(`Socket.io server listening on port ${PORT}`);
});
