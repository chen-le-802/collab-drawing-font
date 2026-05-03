export interface UserVO {
  userId: number
  username: string
  avatar?: string
  role?: number
  status?: number
  createdAt?: string
  updatedAt?: string
}

export interface LoginVO {
  token: string
  user: UserVO
}

export interface RegisterVO {
  userId: number
  username: string
  avatar?: string
}

export interface UpdateProfileDTO {
  username?: string
  avatar?: string
}
