
import { supabase } from './supabase'

export interface TopicResource {
  id: string
  title: string
  input_method: 'url' | 'manual_text'
  source_url: string | null
  created_at: string
}

export interface CreatedUrlResource {
  id: string
  title: string
  isDuplicate: boolean
}

const RESOURCE_COLUMNS =
  'id, title, input_method, source_url, created_at'

// Fetch URL resources and manual notes belonging to the current user.
export const fetchUserResources = async (
  userId: string
): Promise<TopicResource[]> => {
  const { data, error } = await supabase
    .from('resources')
    .select(RESOURCE_COLUMNS)
    .eq('user_id', userId)
    .in('input_method', ['url', 'manual_text'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching resources:', error)
    throw new Error('Could not load your resources. Please try again.')
  }

  return (data ?? []) as TopicResource[]
}

// Fetch resource IDs already assigned to a particular topic.
export const fetchTopicResourceIds = async (
  userId: string,
  topicId: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from('resource_topics')
    .select('resource_id')
    .eq('user_id', userId)
    .eq('topic_id', topicId)

  if (error) {
    console.error('Error fetching topic resources:', error)
    throw new Error(
      'Could not load this topic’s resources. Please try again.'
    )
  }

  return (data ?? []).map((link) => link.resource_id)
}

// Create a URL resource using the existing Edge Function.
export const createUrlResource = async (
  sourceUrl: string,
  title?: string
): Promise<CreatedUrlResource> => {
  const { data, error } = await supabase.functions.invoke(
    'create-resource',
    {
      body: {
        input_method: 'url',
        source_url: sourceUrl.trim(),
        title: title?.trim() || undefined,
      },
    }
  )

  if (error) {
    console.error('Error creating URL resource:', error)
    throw new Error('Could not add this URL. Please check it and try again.')
  }

  const resource = data?.data

  if (!resource?.id || !resource?.title) {
    console.error('Unexpected resource creation response:', data)
    throw new Error(
      'The resource was created, but its details could not be retrieved.'
    )
  }

  return {
    id: resource.id,
    title: resource.title,
    isDuplicate: data.is_duplicate === true,
  }
}

// Save selected resource associations for one topic.
// Associations with other topics are never modified.
export const saveTopicResources = async (
  userId: string,
  topicId: string,
  selectedResourceIds: string[]
): Promise<void> => {
  const existingResourceIds = await fetchTopicResourceIds(
    userId,
    topicId
  )

  const existingSet = new Set(existingResourceIds)
  const selectedSet = new Set(selectedResourceIds)

  const resourceIdsToAdd = [...selectedSet].filter(
    (id) => !existingSet.has(id)
  )

  const resourceIdsToRemove = [...existingSet].filter(
    (id) => !selectedSet.has(id)
  )

  if (resourceIdsToAdd.length > 0) {
    const { error } = await supabase
      .from('resource_topics')
      .insert(
        resourceIdsToAdd.map((resourceId) => ({
          user_id: userId,
          topic_id: topicId,
          resource_id: resourceId,
        }))
      )

    if (error) {
      console.error('Error assigning resources:', error)
      throw new Error(
        'Could not assign the selected resources. Please try again.'
      )
    }
  }

  if (resourceIdsToRemove.length > 0) {
    const { error } = await supabase
      .from('resource_topics')
      .delete()
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .in('resource_id', resourceIdsToRemove)

    if (error) {
      console.error('Error removing topic associations:', error)
      throw new Error(
        'Some new assignments were saved, but removing the deselected resources failed. Please review the topic and try again.'
      )
    }
  }
}
