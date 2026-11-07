
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchResourceTopicLinks,
  fetchTopics,
  type ResourceTopicLink,
  type Topic,
} from '../lib/topics'

export interface TopicWithCount extends Topic {
  resourceCount: number
}

interface UseTopicDataReturn {
  topics: TopicWithCount[]
  loading: boolean
  error: string | null
  refreshTopics: () => Promise<void>
}

const loadTopicData = async (userId: string): Promise<TopicWithCount[]> => {
  const [topicData, resourceLinks]: [Topic[], ResourceTopicLink[]] =
    await Promise.all([
      fetchTopics(userId),
      fetchResourceTopicLinks(userId),
    ])

  const resourceCounts = new Map<string, number>()

  resourceLinks.forEach((link) => {
    resourceCounts.set(
      link.topic_id,
      (resourceCounts.get(link.topic_id) ?? 0) + 1
    )
  })

  return topicData.map((topic) => ({
    ...topic,
    resourceCount: resourceCounts.get(topic.id) ?? 0,
  }))
}

export const useTopicData = (): UseTopicDataReturn => {
  const { user } = useAuth()

  const [topics, setTopics] = useState<TopicWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initial data loading.
  useEffect(() => {
    if (!user) return

    let cancelled = false

    loadTopicData(user.id)
      .then((data) => {
        if (cancelled) return
        setTopics(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return

        console.error('Error loading topic data:', err)
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong while loading topics.'
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  // Refresh after create, edit or delete actions.
  const refreshTopics = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      const data = await loadTopicData(user.id)
      setTopics(data)
    } catch (err: unknown) {
      console.error('Error refreshing topics:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong while refreshing topics.'
      )
    } finally {
      setLoading(false)
    }
  }, [user])

  return {
    topics,
    loading,
    error,
    refreshTopics,
  }
}
