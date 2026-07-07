"use client"

import type React from "react"
import { useState, useEffect, createContext, useContext } from "react"
import { ADMIN_SESSION_STORAGE_KEY } from "./admin-session"

export interface AdminUser {
  id: string
  email: string
  name: string
}

interface AuthContextType {
  admin: AdminUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const verifySession = async () => {
      const sessionId = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)
      if (sessionId) {
        try {
          const response = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify", sessionId }),
          })

          const data = await response.json()
          if (data.success) {
            setAdmin(data.admin)
          } else {
            localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
          }
        } catch (error) {
          console.error("Session verification failed:", error)
          localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
        }
      }
      setIsLoading(false)
    }

    verifySession()
  }, [])

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      })

      const data = await response.json()

      if (data.success) {
        setAdmin(data.admin)
        localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, data.sessionId)
        setIsLoading(false)
        return true
      }
    } catch (error) {
      console.error("Login failed:", error)
    }

    setIsLoading(false)
    return false
  }

  const logout = async () => {
    const sessionId = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY)

    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout", sessionId }),
      })
    } catch (error) {
      console.error("Logout failed:", error)
    }

    setAdmin(null)
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
  }

  return <AuthContext.Provider value={{ admin, isLoading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
