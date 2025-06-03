import { Request, Response, NextFunction, Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { User } from "../../models/types";
import { sendEmail } from "../../utils/email";
import { UserService } from "../../services/userService";

const prisma = new PrismaClient();
const router = Router();
const userService = new UserService();

const authenticateTokenOrSession = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log("authenticateTokenOrSession middleware called.");
  
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    console.log("Token found in request:", token);
    jwt.verify(
      token,
      process.env.JWT_SECRET || "secretkey",
      async (err, decodedToken: any) => {
        if (err) {
          console.error("JWT verification error:", err);
          return res.sendStatus(403);
        }
        console.log("JWT decoded successfully:", decodedToken);
        try {
          const user = await prisma.user.findUnique({
            where: { id: decodedToken.userId },
            include: { role: true },
          });
          if (!user) {
            console.error("User not found for decoded token:", decodedToken);
            return res.sendStatus(403);
          }
          req.user = user;
          console.log(
            "User authenticated and attached to req.user:",
            user.email
          );
          next();
        } catch (error) {
          console.error(
            "Error fetching user from token or attaching to req.user:",
            error
          );
          res.sendStatus(500);
        }
      }
    );
  } else if (req.isAuthenticated && req.isAuthenticated()) {
    console.log("No token found, checking passport session.");
    // If no token, check passport session
    if (req.user && typeof req.user !== "string") {
      // req.user from passport session is the full user object from deserializeUser
      req.user = req.user as User;
      console.log("User authenticated via session and attached to req.user.");
      next();
    } else {
      console.log("Passport session found, but req.user is not valid.");
      res.sendStatus(401);
    }
  } else {
    console.log("No token or active session found. Sending 401.");
    res.sendStatus(401);
  }
};

// Passport Google OAuth setup
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      callbackURL: "https://ai-finn-backend.onrender.com/api/auth/google/callback",  
    },
    async (accessToken: any, refreshToken: any, profile: any, done: any) => {
      try {
        const email = profile.emails && profile.emails[0].value;
        if (!email) {
          return done(new Error("No email found in Google profile"));
        }

        let user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          // Get role id for 'employer' role
          const role = await prisma.role.findUnique({
            where: { name: "employer" },
          });
          if (!role) {
            return done(new Error('Role "employer" not found'));
          }

          // Extract profile picture URL from Google profile
          const profilePicture = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : undefined;

          // Extract first and last name from Google profile
          const firstName = profile.name?.givenName || undefined;
          const lastName = profile.name?.familyName || undefined;

          // Extract birthday if available (Google profile does not provide birthday by default)
          // This requires additional scopes and API calls, so we leave it undefined for now
          const dateOfBirth = undefined;

          // Create new user with valid roleId, profilePicture, firstName, lastName, and dateOfBirth
          user = await prisma.user.create({
            data: {
              email,
              password: "", // No password for OAuth users
              roleId: role.id,
              profilePicture,
              firstName,
              lastName,
              dateOfBirth,
            },
          });
        }

        done(null, user);
      } catch (error) {
        done(error);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
    passport.deserializeUser(async (id: string, done) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id },
          include: { role: true }, // Include role to match the User interface
        });
        // Convert dateOfBirth from Date | null to string | undefined to match User interface
        if (user && user.dateOfBirth instanceof Date) {
          (user as any).dateOfBirth = user.dateOfBirth.toISOString();
        } else if (user) {
          (user as any).dateOfBirth = undefined;
        }
        done(null, user as unknown as User); // Cast via unknown to avoid TS error
      } catch (error) {
        done(error);
      }
    });

// Initialize passport middleware
router.use(passport.initialize());
router.use(passport.session());

// Google OAuth routes
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req: any, res: Response) => {
    // Successful authentication, generate JWT token and redirect to frontend with token
    const user = req.user;
    if (!user) {
      return res.redirect(
        `${process.env.FRONTEND_URL || "https://ai-finn-frontend-eahlnh7yv-obald123s-projects.vercel.app"}/login`
      );
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role?.name || "user" },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.redirect(
      `${
        process.env.FRONTEND_URL || "https://ai-finn-frontend-eahlnh7yv-obald123s-projects.vercel.app"
      }/auth/callback?token=${token}`
    );
  }
);

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role.name },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "1h" }
    );

    res.json({ token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// New endpoints for forgot password and reset password
router.post("/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const token = await userService.createPasswordResetToken(email);
    const resetUrl = `${process.env.FRONTEND_URL || "https://ai-finn-frontend-eahlnh7yv-obald123s-projects.vercel.app"}/reset-password?token=${token}`;

    const html = `
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await sendEmail(email, "Password Reset Request", html);

    res.json({ message: "Password reset email sent" });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ message: "Token and new password are required" });
  }

  try {
    await userService.resetPassword(token, newPassword);
    res.json({ message: "Password has been reset successfully" });
  } catch (error: any) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// New endpoint to get current user info
router.get(
  "/me",
  authenticateTokenOrSession,
  async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
          address: true,
          notificationsEnabled: true,
          theme: true,
          profilePicture: true,
          role: { select: { name: true } },
        },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        address: user.address,
        notificationsEnabled: user.notificationsEnabled,
        theme: user.theme,
        profilePicture: user.profilePicture,
        role: user.role.name,
      });
    } catch (error) {
      console.error("Get current user error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
