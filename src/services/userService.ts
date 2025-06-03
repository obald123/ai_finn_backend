import { PrismaClient } from "@prisma/client";
import { User } from "../models/types";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

export class UserService {
  async getAllUsers(): Promise<User[]> {
    const users = await prisma.user.findMany({
      include: { role: true },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      role: { name: user.role?.name || "employee" },
      firstName: (user as any)["firstName"] ?? undefined,
      lastName: (user as any)["lastName"] ?? undefined,
      dateOfBirth: (user as any)["dateOfBirth"]
        ? (user as any)["dateOfBirth"].toISOString()
        : undefined,
      gender: (user as any)["gender"] ?? undefined,
      address: (user as any)["address"] ?? undefined,
      idNumber: (user as any)["idNumber"] ?? undefined,
      profilePicture: (user as any)["profilePicture"] ?? undefined,
    }));
  }

  async createUser(
    email: string,
    password: string,
    roleName: string,
    firstName?: string,
    lastName?: string,
    dateOfBirth?: string,
    gender?: string,
    address?: string,
    idNumber?: string,
    profilePicture?: string
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10);
    const role = await prisma.role.findUnique({ where: { name: roleName } });

    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }

    try {
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          roleId: role.id,
          firstName,
          lastName,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          gender,
          address,
          idNumber,
          profilePicture,
        },
        include: { role: true },
      });
      return {
        id: user.id,
        email: user.email,
        role: { name: user.role?.name || "employee" },
        firstName: (user as any)["firstName"] ?? undefined,
        lastName: (user as any)["lastName"] ?? undefined,
        dateOfBirth: (user as any)["dateOfBirth"]
          ? (user as any)["dateOfBirth"].toISOString()
          : undefined,
        gender: (user as any)["gender"] ?? undefined,
        address: (user as any)["address"] ?? undefined,
        idNumber: (user as any)["idNumber"] ?? undefined,
        profilePicture: (user as any)["profilePicture"] ?? undefined,
      };
    } catch (error: any) {
      if (error.code === "P2002" && error.meta?.target?.includes("email")) {
        throw new Error("Email already exists");
      }
      throw error;
    }
  }

  async updateUser(
    id: string,
    email?: string,
    roleName?: string,
    username?: string,
    notificationsEnabled?: boolean,
    theme?: string,
    firstName?: string,
    lastName?: string,
    dateOfBirth?: string,
    gender?: string,
    address?: string,
    idNumber?: string,
    profilePicture?: string
  ): Promise<User> {
    const updateData: any = {};
    if (email) {
      updateData.email = email;
    }
    if (roleName) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        throw new Error(`Role ${roleName} not found`);
      }
      updateData.roleId = role.id;
    }
    if (username !== undefined) {
      updateData.username = username ?? undefined;
    }
    if (notificationsEnabled !== undefined) {
      updateData.notificationsEnabled = notificationsEnabled;
    }
    if (theme !== undefined) {
      updateData.theme = theme;
    }
    if (firstName !== undefined) {
      updateData.firstName = firstName;
    }
    if (lastName !== undefined) {
      updateData.lastName = lastName;
    }
    if (dateOfBirth !== undefined) {
      updateData.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    }
    if (gender !== undefined) {
      updateData.gender = gender;
    }
    if (address !== undefined) {
      updateData.address = address;
    }
    if (idNumber !== undefined) {
      updateData.idNumber = idNumber;
    }
    if (profilePicture !== undefined) {
      updateData.profilePicture = profilePicture;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
    });
    return {
      id: user.id,
      email: user.email,
      role: { name: user.role?.name || "employee" },
      username: user.username ?? undefined,
      notificationsEnabled: user.notificationsEnabled,
      theme: user.theme,
      firstName: (user as any)["firstName"] ?? undefined,
      lastName: (user as any)["lastName"] ?? undefined,
      dateOfBirth: (user as any)["dateOfBirth"]
        ? (user as any)["dateOfBirth"].toISOString()
        : undefined,
      gender: (user as any)["gender"] ?? undefined,
      address: (user as any)["address"] ?? undefined,
      idNumber: (user as any)["idNumber"] ?? undefined,
      profilePicture: (user as any)["profilePicture"] ?? undefined,
    };
  }

  async deleteUser(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }

  async getUserById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      role: { name: user.role?.name || "employee" },
      username: user.username ?? undefined,
      notificationsEnabled: user.notificationsEnabled,
      theme: user.theme,
      firstName: (user as any)["firstName"] ?? undefined,
      lastName: (user as any)["lastName"] ?? undefined,
      dateOfBirth: (user as any)["dateOfBirth"]
        ? (user as any)["dateOfBirth"].toISOString()
        : undefined,
      gender: (user as any)["gender"] ?? undefined,
      address: (user as any)["address"] ?? undefined,
      idNumber: (user as any)["idNumber"] ?? undefined,
      profilePicture: (user as any)["profilePicture"] ?? undefined,
    };
  }

  async createPasswordResetToken(email: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("User with this email does not exist");
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour expiry

    // Save token in PasswordResetToken table
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    return token;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      throw new Error("Invalid or expired password reset token");
    }

    if (resetToken.expiresAt < new Date()) {
      // Delete expired token
      await prisma.passwordResetToken.delete({ where: { token } });
      throw new Error("Password reset token has expired");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user's password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    });

    // Delete the token after successful reset
    await prisma.passwordResetToken.delete({ where: { token } });
  }
}
