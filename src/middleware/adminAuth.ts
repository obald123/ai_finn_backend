import { Request, Response, NextFunction } from "express";

interface UserWithRole {
  role: {
    name: string;
  };
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized: No user information" });
  }
  const user = req.user as UserWithRole;
  if (user.role.name !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admins only" });
  }
  next();
}
