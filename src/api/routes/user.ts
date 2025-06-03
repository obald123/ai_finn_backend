import { Router, Request, Response, NextFunction } from "express";
import { UserService } from "../../services/userService";
import { User } from "../../models/types";
import authenticateTokenOrSession from "./auth";
import { z } from "zod";

const router = Router();
const userService = new UserService();

const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "Unauthorized: No user authenticated" });
    }
    const user = req.user as User;

    if (!roles.includes(user.role.name) && user.role.name !== "employer") {
      return res
        .status(403)
        .json({ message: "Forbidden: Insufficient permissions" });
    }
    next();
  };
};

const userCreationSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    ),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  address: z.string().optional(),
  idNumber: z.string().optional(),
  profilePicture: z.string().optional(),
  roleName: z.string().min(1, "Role name is required"),
});

router.get(
  "/",
  authenticateTokenOrSession,
  authorize(["admin", "employee"]),
  async (req: Request, res: Response) => {
    try {
      const users = await userService.getAllUsers();
      res.json(users);
    } catch (error: unknown) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }
);

router.post(
  "/",
  authenticateTokenOrSession,
  authorize(["admin", "employee"]),
  async (req: Request, res: Response) => {
    try {
      const parseResult = userCreationSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ errors: parseResult.error.errors });
      }
      const {
        firstName,
        lastName,
        email,
        password,
        dateOfBirth,
        gender,
        address,
        idNumber,
        profilePicture,
        roleName,
      } = parseResult.data;

      const newUser = await userService.createUser(
        email,
        password,
        roleName,
        firstName,
        lastName,
        dateOfBirth,
        gender,
        address,
        idNumber,
        profilePicture
      );
      res.status(201).json(newUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res
        .status(500)
        .json({ error: "Failed to create user", details: message });
    }
  }
);

router.put(
  "/:id",
  authenticateTokenOrSession,
  authorize(["admin", "employee"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        email,
        roleName,
        username,
        notificationsEnabled,
        theme,
        firstName,
        lastName,
        dateOfBirth,
        gender,
        address,
        idNumber,
        profilePicture,
      } = req.body;
      const updatedUser = await userService.updateUser(
        id,
        email,
        roleName,
        username,
        notificationsEnabled,
        theme,
        firstName,
        lastName,
        dateOfBirth,
        gender,
        address,
        idNumber,
        profilePicture
      );
      res.json(updatedUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res
        .status(500)
        .json({ error: "Failed to update user", details: message });
    }
  }
);

router.delete(
  "/:id",
  authenticateTokenOrSession,
  authorize(["admin", "employee"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await userService.deleteUser(id);
      res.status(204).send();
    } catch (error: unknown) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  }
);

router.get(
  "/:id",
  authenticateTokenOrSession,
  authorize(["admin", "employee"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const userWithDefaults = {
        ...user,
        firstName: (user as any).firstName ?? "",
        lastName: (user as any).lastName ?? "",
        dateOfBirth: (user as any).dateOfBirth ?? "",
        gender: (user as any).gender ?? "",
        address: (user as any).address ?? "",
        idNumber: (user as any).idNumber ?? "",
        profilePicture: (user as any).profilePicture ?? "",
      };
      res.json(userWithDefaults);
    } catch (error: unknown) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  }
);

export default router;
