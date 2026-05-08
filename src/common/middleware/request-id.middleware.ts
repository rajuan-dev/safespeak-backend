import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = req.header('X-Request-Id') ?? uuidv4();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
};
