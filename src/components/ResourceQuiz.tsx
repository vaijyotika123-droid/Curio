
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type QuizOption = {
  id: string
  text: string
}

type QuizQuestion = {
  id: string
  question: string
  options: QuizOption[]
}

type QuizResult = {
  questionId: string
  selectedOptionId: string
  correctOptionId: string
  isCorrect: boolean
  explanation: string
}

type QuizSubmission = {
  success: boolean
  score: number
  total_questions: number
  percentage: number
  results: QuizResult[]
}

type QuizAttempt = {
  id: string
  quiz_id: string
  status: 'in_progress' | 'completed'
  answers: Record<string, string>
  score: number
  total_questions: number
}

type ResourceQuizProps = {
  resourceId: string
}

export const ResourceQuiz: React.FC<ResourceQuizProps> = ({
  resourceId,
}) => {
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizSubmission | null>(null)
  const [savedScore, setSavedScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadExistingQuiz = async () => {
      setLoading(true)
      setError(null)
      setQuestions([])
      setAttemptId(null)
      setAnswers({})
      setResult(null)
      setSavedScore(null)

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        if (authError || !user) {
          throw new Error('Please sign in to access quizzes.')
        }

        const { data: quizzes, error: quizError } = await supabase
          .from('quizzes')
          .select('id, question_set, created_at')
          .eq('resource_id', resourceId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)

        if (quizError) throw quizError

        const quiz = quizzes?.[0]
        if (!quiz || cancelled) return

        const { data: attempt, error: attemptError } = await supabase
          .from('quiz_attempts')
          .select(
            'id, quiz_id, status, answers, score, total_questions'
          )
          .eq('quiz_id', quiz.id)
          .eq('user_id', user.id)
          .maybeSingle()

        if (attemptError) throw attemptError
        if (!attempt || cancelled) return

        const typedAttempt = attempt as QuizAttempt

        setQuestions(quiz.question_set as QuizQuestion[])
        setAttemptId(typedAttempt.id)
        setAnswers(typedAttempt.answers || {})

        if (typedAttempt.status === 'completed') {
          setSavedScore(typedAttempt.score)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load your quiz.'
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadExistingQuiz()

    return () => {
      cancelled = true
    }
  }, [resourceId])

  const generateQuiz = async () => {
    if (generating) return

    setGenerating(true)
    setError(null)

    try {
      const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 60000)

let data
let functionError

try {
  const response = await supabase.functions.invoke('generate-quiz', {
    body: { resource_id: resourceId },
    signal: controller.signal,
  })

  data = response.data
  functionError = response.error
} finally {
  clearTimeout(timeout)
}

      if (functionError) {
        throw new Error(
          functionError.message || 'Quiz generation failed.'
        )
      }

      if (!data?.success || !Array.isArray(data.questions)) {
        throw new Error(
          data?.error?.message || 'Invalid quiz response.'
        )
      }

      setQuestions(data.questions as QuizQuestion[])
      setAttemptId(data.attempt_id)
      setAnswers({})
      setResult(null)
      setSavedScore(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to generate quiz.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const submitQuiz = async () => {
    if (!attemptId || submitting || savedScore !== null || result) {
      return
    }

    if (questions.some((question) => !answers[question.id])) {
      setError('Please answer all five questions before submitting.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const { data, error: functionError } =
        await supabase.functions.invoke('submit-quiz', {
          body: {
            attempt_id: attemptId,
            answers,
          },
        })

      if (functionError) {
        throw new Error(
          functionError.message || 'Quiz submission failed.'
        )
      }

      if (!data?.success || !Array.isArray(data.results)) {
        throw new Error(
          data?.error || 'Invalid submission response.'
        )
      }

      setResult(data as QuizSubmission)
      setSavedScore(data.score)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to submit quiz.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const completed = result !== null || savedScore !== null
  const answeredCount = questions.filter(
    (question) => Boolean(answers[question.id])
  ).length

  const resultByQuestion = new Map(
    result?.results.map((item) => [item.questionId, item]) || []
  )

  if (loading) {
    return (
      <section style={sectionStyle}>
        <h2>Test your understanding</h2>
        <p>Loading quiz...</p>
      </section>
    )
  }

  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>Test your understanding</h2>

      <p style={{ color: '#64748b', lineHeight: 1.6 }}>
        Check how well you understand this resource with five
        AI-generated multiple-choice questions.
      </p>

      {error && (
        <p
          role="alert"
          style={{
            color: '#b91c1c',
            background: '#fef2f2',
            padding: '0.75rem',
            borderRadius: '0.5rem',
          }}
        >
          {error}
        </p>
      )}

      {questions.length === 0 ? (
        <button
          type="button"
          className="btn-primary"
          disabled={generating}
          onClick={() => void generateQuiz()}
        >
          {generating ? 'Generating quiz...' : 'Generate Quiz'}
        </button>
      ) : (
        <>
          {completed && (
            <div
              style={{
                padding: '1.25rem',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem' }}>
                Quiz completed
              </h3>

              <p
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                {result?.score ?? savedScore} / {questions.length}
              </p>

              <p style={{ marginBottom: 0, color: '#475569' }}>
                {result
                  ? `${result.percentage}% correct`
                  : 'Your saved quiz result'}
              </p>
            </div>
          )}

          {!completed && (
            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
              {answeredCount} of {questions.length} answered
            </p>
          )}

          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {questions.map((question, index) => {
              const feedback = resultByQuestion.get(question.id)

              return (
                <div
                  key={question.id}
                  style={{
                    padding: '1.25rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.75rem',
                    background: '#fff',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1rem',
                      lineHeight: 1.6,
                      margin: '0 0 1rem',
                    }}
                  >
                    {index + 1}. {question.question}
                  </h3>

                  <div style={{ display: 'grid', gap: '0.625rem' }}>
                    {question.options.map((option) => {
                      const selected =
                        answers[question.id] === option.id

                      const isCorrectOption =
                        feedback?.correctOptionId === option.id

                      const isWrongSelection =
                        feedback &&
                        selected &&
                        !feedback.isCorrect

                      return (
                        <label
                          key={option.id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.75rem',
                            padding: '0.875rem',
                            borderRadius: '0.5rem',
                            border: `1px solid ${
                              isCorrectOption
                                ? '#86efac'
                                : isWrongSelection
                                  ? '#fca5a5'
                                  : selected
                                    ? '#818cf8'
                                    : '#e2e8f0'
                            }`,
                            background: isCorrectOption
                              ? '#f0fdf4'
                              : isWrongSelection
                                ? '#fef2f2'
                                : selected
                                  ? '#eef2ff'
                                  : '#fff',
                            cursor: completed
                              ? 'default'
                              : 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name={`quiz-${question.id}`}
                            value={option.id}
                            checked={selected}
                            disabled={completed || submitting}
                            onChange={() => {
                              setAnswers((current) => ({
                                ...current,
                                [question.id]: option.id,
                              }))
                              setError(null)
                            }}
                          />

                          <span style={{ lineHeight: 1.5 }}>
                            {option.text}
                          </span>
                        </label>
                      )
                    })}
                  </div>

                  {feedback && (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '0.875rem',
                        background: '#f8fafc',
                        borderRadius: '0.5rem',
                      }}
                    >
                      <strong
                        style={{
                          color: feedback.isCorrect
                            ? '#15803d'
                            : '#b91c1c',
                        }}
                      >
                        {feedback.isCorrect ? 'Correct' : 'Incorrect'}
                      </strong>

                      <p
                        style={{
                          margin: '0.5rem 0 0',
                          lineHeight: 1.7,
                          color: '#334155',
                        }}
                      >
                        {feedback.explanation}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {!completed && (
            <div style={{ marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  submitting ||
                  answeredCount !== questions.length
                }
                onClick={() => void submitQuiz()}
              >
                {submitting
                  ? 'Submitting...'
                  : 'Submit Quiz'}
              </button>
            </div>
          )}

          {completed && !result && (
            <p
              style={{
                marginTop: '1rem',
                color: '#64748b',
                fontSize: '0.875rem',
              }}
            >
              Your score and saved answers are shown above.
              Detailed explanations are available immediately
              after submitting a new quiz.
            </p>
          )}
        </>
      )}
    </section>
  )
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  backgroundColor: '#fff',
  marginBottom: '1.25rem',
}
