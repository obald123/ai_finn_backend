import { User } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}