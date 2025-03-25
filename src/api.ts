import cors from 'cors';
import express, { Request, Response } from 'express';

import { deepResearch, writeFinalAnswer } from './deep-research';

const app = express();
const port = process.env.PORT || 3051;

app.use(cors());
app.use(express.json());

function log(...args: any[]) {
  console.log(...args);
}

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
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      console.log('Часть данных:', chunk);
      result += chunk;
    }

    return res.send(result);
  } catch (error: any) {
    console.error('Ошибка запроса:', error);
    return res
      .status(500)
      .json({ error: 'Ошибка проксирования: ' + error.message });
  }
});

app.post('/api/research', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    log('\nStarting research...\n');

    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
    });

    log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
    log(
      `\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`,
    );

    const answer = await writeFinalAnswer({
      prompt: query,
      learnings,
    });

    // Return the results
    return res.json({
      success: true,
      answer,
      learnings,
      visitedUrls,
    });
  } catch (error: unknown) {
    console.error('Error in research API:', error);
    return res.status(500).json({
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
