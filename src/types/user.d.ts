export interface UserVO {
  userId: number
  username: string
  avatar?: string
}

export interface LoginVO {
  token: string
  user: UserVO
}

export interface RegisterVO {
  userId: number
  username: string
}