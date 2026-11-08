import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '@stockflow/shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, required: true, default: true },
    mustChangePassword: { type: Boolean, required: true, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ name: 1 });

export type UserRecord = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type UserDocument = HydratedDocument<UserRecord>;

export const User = model('User', userSchema);
