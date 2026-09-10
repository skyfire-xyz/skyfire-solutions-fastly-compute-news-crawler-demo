"use client"

import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react"
import axios, { AxiosInstance, AxiosResponse, isAxiosError } from "axios"

import {
  SkyfireAction,
  addResponse,
  clearResponses,
  loading,
  replaceResponse,
  updateError,
  updateSkyfireAPIKey,
  updateSkyfireClaims,
  updateSkyfireRules,
  updateSkyfireWallet,
  updateTOSAgreement,
} from "@/lib/skyfire-sdk/context/action"

import { toast } from "../custom-shadcn/hooks/use-toast"
import { initialState, skyfireReducer } from "./reducer"
import { PaymentClaim, SkyfireState } from "./type"

declare module "axios" {
  export interface AxiosRequestConfig {
    metadataForAgent?: {
      title?: string
      useWithChat?: boolean
      correspondingPageURLs: string[]
      customizeResponse?: (response: AxiosResponse) => AxiosResponse
      customPrompts: string[]
      replaceExisting?: boolean
    }
  }
}
interface SkyfireContextType {
  state: SkyfireState
  dispatch: React.Dispatch<SkyfireAction>
  apiClient: AxiosInstance | null
  logout: () => void
  pushResponse: (response: AxiosResponse) => void
  replaceExistingResponse: (response: AxiosResponse) => void
  resetResponses: () => void
  getClaimByReferenceID: (referenceId: string | null) => Promise<boolean>
  fetchAndCompareClaims: () => Promise<void>
}

export const getItemNamesFromResponse = (response: AxiosResponse): string => {
  const config = response.config
  const title = config.metadataForAgent?.title || config.url || "Unknown"
  return title
}

const SkyfireContext = createContext<SkyfireContextType | undefined>(undefined)

export const SkyfireProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(skyfireReducer, initialState)
  const previousClaimsRef = useRef<PaymentClaim[] | null>(state.claims)

  // Bare client. Interceptors are attached in an effect below so that no
  // side-effectful registration happens during render.
  const apiClient = useMemo(() => {
    if (!state.localAPIKey) return null
    return axios.create({
      baseURL:
        process.env.NEXT_PUBLIC_SKYFIRE_API_URL || "https://api.skyfire.xyz",
    })
  }, [state.localAPIKey])

  useEffect(() => {
    const tosAgreed = localStorage.getItem("tosAgreed")
    if (tosAgreed !== null) {
      dispatch(updateTOSAgreement(JSON.parse(tosAgreed)))
    }
  }, [])

  const logout = useCallback(() => {
    dispatch(updateSkyfireAPIKey(null))
  }, [])

  const pushResponse = useCallback((response: AxiosResponse) => {
    dispatch(addResponse(response))
  }, [])

  const replaceExistingResponse = useCallback((response: AxiosResponse) => {
    dispatch(replaceResponse(response))
  }, [])

  const resetResponses = useCallback(() => {
    dispatch(clearResponses())
  }, [])

  const fetchUserBalance = useCallback(async () => {
    if (apiClient) {
      try {
        const res = await apiClient.get("/v1/wallet/balance")
        dispatch(updateSkyfireWallet(res.data))
      } catch (e) {
        if (isAxiosError(e)) {
          dispatch(updateError(e))
        }
      }
    }
  }, [apiClient])

  const fetchReceivers = useCallback(async () => {
    if (apiClient) {
      try {
        const res = await apiClient.get("/v1/users/receivers/list")
        dispatch({ type: "UPDATE_SKYFIRE_RECEIVERS", payload: res.data } as any)
      } catch (e) {
        if (isAxiosError(e)) {
          dispatch(updateError(e))
        }
      }
    }
  }, [apiClient])

  const fetchUserRules = useCallback(async () => {
    if (apiClient) {
      try {
        const res = await apiClient.get("/v1/users/rules")
        dispatch(updateSkyfireRules(res.data))
      } catch (e) {
        if (isAxiosError(e)) {
          dispatch(updateError(e))
        }
      }
    }
  }, [apiClient])

  const fetchUserClaims = useCallback(async () => {
    if (apiClient) {
      try {
        const res = await apiClient.get("/v1/wallet/claims")
        previousClaimsRef.current = res.data.claims
        dispatch(updateSkyfireClaims(res.data))
      } catch (e: unknown) {
        if (isAxiosError(e)) {
          dispatch(updateError(e))
        }
      }
    }
  }, [apiClient])

  const fetchAndCompareClaims = useCallback(async () => {
    if (!apiClient) return

    try {
      const response = await apiClient.get("/v1/wallet/claims")
      const newClaims = response.data.claims
      const previousClaims = previousClaimsRef.current || []

      if (Array.isArray(newClaims)) {
        const previousClaimsSet = new Set(
          previousClaims.map((claim) => claim.id)
        )

        const spent = newClaims.reduce((acc, claim) => {
          if (!previousClaimsSet.has(claim.id)) {
            return acc + Number(claim.value)
          }
          return acc
        }, 0)
        if (spent > 0) {
          toast({
            title: `Spent ${spent}`,
            duration: 3000,
          })
        }
        previousClaimsRef.current = newClaims
      } else {
        console.error("Unexpected data format for claims:", newClaims)
      }
    } catch (error) {
      console.error("Error fetching claims:", error)
    }
    await fetchUserBalance()
  }, [apiClient, fetchUserBalance])

  const getClaimByReferenceID = useCallback(
    async (referenceId: string | null) => {
      if (!referenceId || !apiClient) {
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
      try {
        await apiClient.get(`v1/wallet/claimByReferenceId/${referenceId}`)
      } catch (error) {
        console.error("Error fetching claim:", error)
      }

      return false
    },
    [apiClient]
  )

  // Attach the interceptors to the current client, ejecting them if the client
  // is replaced. Declared before the fetch effect below so that the initial
  // requests already carry the API key header.
  useEffect(() => {
    if (!apiClient) return

    const requestId = apiClient.interceptors.request.use(
      (config) => {
        config.headers["skyfire-api-key"] = state.localAPIKey
        if (config.url?.includes("start-crawler")) {
          dispatch(loading(true))
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    const responseId = apiClient.interceptors.response.use(
      async (response) => {
        if (response.config.metadataForAgent?.useWithChat) {
          if (response.config.metadataForAgent?.customizeResponse) {
            if (response.config.metadataForAgent?.replaceExisting) {
              replaceExistingResponse(
                response.config.metadataForAgent?.customizeResponse(response)
              )
            } else {
              pushResponse(
                response.config.metadataForAgent?.customizeResponse(response)
              )
            }
          } else {
            if (response.config.metadataForAgent?.replaceExisting) {
              replaceExistingResponse(response)
            } else {
              pushResponse(response)
            }
          }
        }

        // Can Process Payment Here
        setTimeout(() => {
          dispatch(loading(false))
          if (response.config.url?.includes("start-crawl")) {
            fetchAndCompareClaims()
          }
        }, 500)
        return response
      },
      (error) => {
        dispatch(loading(false))
        if (error.response && error.response.status === 401) {
          // Handle unauthorized access
          logout()
        }
        if (error.response?.config?.url?.includes("start-crawl")) {
          fetchAndCompareClaims()
        }
        return Promise.reject(error)
      }
    )

    return () => {
      apiClient.interceptors.request.eject(requestId)
      apiClient.interceptors.response.eject(responseId)
    }
  }, [
    apiClient,
    state.localAPIKey,
    pushResponse,
    replaceExistingResponse,
    logout,
    fetchAndCompareClaims,
  ])

  useEffect(() => {
    if (apiClient) {
      fetchUserBalance()
      fetchUserClaims()
      fetchUserRules()
      fetchReceivers()
    }
  }, [
    apiClient,
    fetchUserBalance,
    fetchUserClaims,
    fetchUserRules,
    fetchReceivers,
  ])

  return (
    <SkyfireContext.Provider
      value={{
        state,
        dispatch,
        apiClient,
        logout,
        pushResponse,
        replaceExistingResponse,
        resetResponses,
        getClaimByReferenceID,
        fetchAndCompareClaims,
      }}
    >
      {children}
    </SkyfireContext.Provider>
  )
}

export const useSkyfire = () => {
  const context = useContext(SkyfireContext)
  if (!context) {
    throw new Error("useSkyfire must be used within a SkyfireProvider")
  }
  return context
}

export const useSkyfireState = () => {
  const context = useContext(SkyfireContext)
  if (!context) {
    throw new Error("useSkyfire must be used within a SkyfireProvider")
  }
  return context.state
}

export const useSkyfireAPIKey = () => {
  const { state } = useSkyfire()

  return {
    localAPIKey: state?.localAPIKey,
    isReady: state?.isAPIKeyInitialized,
  }
}

export const useSkyfireAPIClient = () => {
  const { state, apiClient } = useSkyfire()
  if (!state.localAPIKey) return null
  return apiClient
}

export const useLoadingState = () => {
  const { state } = useSkyfire()
  return state?.loading
}

export const useSkyfireResponses = (pathname: string) => {
  const { state } = useSkyfire()
  if (state?.responses.length > 0) {
    return filterResponsesByUrl(state?.responses, pathname)
  }
  return state?.responses
}

export const useSkyfireRules = () => {
  const { state } = useSkyfire()
  return state?.rules
}

export const useSkyfireRuleById = (ruleId: string) => {
  const { state } = useSkyfire()
  return state?.rules.find((rule) => rule.id === ruleId)
}

export const useSkyfireReceivers = () => {
  const { state } = useSkyfire()
  return state?.receivers
}

function isUrlMatch(pathname: string, urlPatterns: string[]): boolean {
  return urlPatterns.some((pattern) => {
    // Convert the URL pattern to a regex
    const regexPattern = pattern.replace(/\[.*?\]/g, "[^/]+")
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(pathname)
  })
}

function filterResponsesByUrl(
  responses: AxiosResponse[],
  pathname: string
): AxiosResponse[] {
  return responses.filter((response) => {
    const urls = response.config.metadataForAgent?.correspondingPageURLs || []
    return isUrlMatch(pathname, urls)
  })
}

// Add a new hook to easily access and update the TOS agreement state
export const useSkyfireTOSAgreement = () => {
  const { state, dispatch } = useSkyfire()

  const setTOSAgreement = (agreed: boolean) => {
    dispatch(updateTOSAgreement(agreed))
  }

  return {
    tosAgreed: state.tosAgreed,
    setTOSAgreement,
  }
}
