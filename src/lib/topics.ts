
import { supabase } from './supabase'

export interface Topic {
  id: string
  user_id: string
  name: string
  description: string | null
  creation_method: string
  created_at: string
  updated_at: string
}

export interface ResourceTopicLink {
  resource_id: string
  topic_id: string
  user_id: string
}

const TOPIC_COLUMNS =
  'id, user_id, name, description, creation_method, created_at, updated_at'

const MAX_TOPIC_NAME_LENGTH = 80
const MAX_TOPIC_DESCRIPTION_LENGTH = 500

/**
 * Trim a topic name and collapse repeated whitespace.
 */
export const normalizeTopicName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ')

/**
 * Trim a description and collapse repeated spaces
 * while preserving intentional line breaks.
 */
export const normalizeTopicDescription = (value: string): string =>
  value.trim().replace(/[ \t]+/g, ' ')

/**
 * Load all topics belonging to the signed-in user.
 */
export const fetchTopics = async (userId: string): Promise<Topic[]> => {
  const { data, error } = await supabase
    .from('topics')
    .select(TOPIC_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching topics:', error)
    throw new Error('Could not load your topics. Please try again.')
  }

  return (data ?? []) as Topic[]
}

/**
 * Load resource-topic associations belonging to the signed-in user.
 * These links are used to calculate resource counts.
 */
export const fetchResourceTopicLinks = async (
  userId: string
): Promise<ResourceTopicLink[]> => {
  const { data, error } = await supabase
    .from('resource_topics')
    .select('resource_id, topic_id, user_id')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching resource-topic links:', error)
    throw new Error('Could not load topic resource counts. Please try again.')
  }

  return (data ?? []) as ResourceTopicLink[]
}

/**
 * Create a manually entered topic.
 */
export const createTopic = async (
  userId: string,
  name: string,
  description: string
): Promise<Topic> => {
  const normalizedName = normalizeTopicName(name)
  const normalizedDescription = normalizeTopicDescription(description)

  if (!normalizedName) {
    throw new Error('Topic name is required.')
  }

  if (normalizedName.length > MAX_TOPIC_NAME_LENGTH) {
    throw new Error(`Topic name cannot exceed ${MAX_TOPIC_NAME_LENGTH} characters.`)
  }

  if (normalizedDescription.length > MAX_TOPIC_DESCRIPTION_LENGTH) {
    throw new Error(
      `Description cannot exceed ${MAX_TOPIC_DESCRIPTION_LENGTH} characters.`
    )
  }

  const { data, error } = await supabase
    .from('topics')
    .insert({
      user_id: userId,
      name: normalizedName,
      description: normalizedDescription || null,
      creation_method: 'manual',
    })
    .select(TOPIC_COLUMNS)
    .single()

  if (error) {
    console.error('Error creating topic:', error)

    if (error.code === '23505') {
      throw new Error('You already have a topic with this name.')
    }

    throw new Error('Could not create this topic. Please try again.')
  }

  return data as Topic
}

/**
 * Update an existing topic.
 */
export const updateTopic = async (
  userId: string,
  topicId: string,
  name: string,
  description: string
): Promise<Topic> => {
  const normalizedName = normalizeTopicName(name)
  const normalizedDescription = normalizeTopicDescription(description)

  if (!normalizedName) {
    throw new Error('Topic name is required.')
  }

  if (normalizedName.length > MAX_TOPIC_NAME_LENGTH) {
    throw new Error(`Topic name cannot exceed ${MAX_TOPIC_NAME_LENGTH} characters.`)
  }

  if (normalizedDescription.length > MAX_TOPIC_DESCRIPTION_LENGTH) {
    throw new Error(
      `Description cannot exceed ${MAX_TOPIC_DESCRIPTION_LENGTH} characters.`
    )
  }

  const { data, error } = await supabase
    .from('topics')
    .update({
      name: normalizedName,
      description: normalizedDescription || null,
    })
    .eq('id', topicId)
    .eq('user_id', userId)
    .select(TOPIC_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('Error updating topic:', error)

    if (error.code === '23505') {
      throw new Error('You already have a topic with this name.')
    }

    throw new Error('Could not update this topic. Please try again.')
  }

  if (!data) {
    throw new Error('Topic could not be found. Please refresh and try again.')
  }

  return data as Topic
}

/**
 * Delete a topic.
 * Its resource-topic links are removed by the database foreign key.
 * The resources themselves are not deleted.
 */
export const deleteTopic = async (
  userId: string,
  topicId: string
): Promise<void> => {
  const { data, error } = await supabase
    .from('topics')
    .delete()
    .eq('id', topicId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Error deleting topic:', error)
    throw new Error('Could not delete this topic. Please try again.')
  }

  if (!data) {
    throw new Error('Topic could not be found. Please refresh and try again.')
  }
}
