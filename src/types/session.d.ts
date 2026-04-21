export type SessionStatus = 0 | 1

export interface MemberVO {
  userId: number
  username: string
  role: number
  onlineStatus: number
  joinedAt: string
}

// 会话列表卡片使用的数据结构。
export interface SessionVO {
  sessionId: number
  sessionKey: string
  name: string
  thumbnail?: string
  status: SessionStatus
  creatorId: number
  creatorName?: string
  memberCount?: number
  currentVersion?: number
  createdAt: string
}

export interface GraphicVO {
  [key: string]: unknown
}

// 会话详情在基础字段上补充成员信息。
export interface SessionDetailVO extends SessionVO {
  members: MemberVO[]
  currentVersion: number
}

// 加入会话后返回会话基础信息和当前画布全量数据。
export interface SessionJoinVO {
  sessionId: number
  sessionKey: string
  name: string
  currentVersion: number
  graphics: GraphicVO[]
}

export interface SessionListVO {
  list: SessionVO[]
  total: number
  page: number
  pageSize: number
}
