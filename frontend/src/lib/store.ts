import { create } from "zustand";

export type UserInfo = {
  id: string;
  email: string;
  nickname: string;
  subscription_status: string;
  credits: number;
};

type UserStore = {
  user: UserInfo | null;
  setUser: (user: UserInfo | null) => void;
  clearUser: () => void;
};

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}));
