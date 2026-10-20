export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Voice AI Interviewer API',
    version: '1.0.0',
    description: 'REST API for the Voice AI Interviewer platform, managing user authentication, profiles, resumes, and interview sessions.',
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local API server',
    },
  ],
  tags: [
    { name: 'Health', description: 'System health check' },
    { name: 'Auth', description: 'Accounts are Supabase Auth users: sign up, sign in and password reset happen against Supabase, and the API only verifies the access token' },
    { name: 'Providers', description: 'Bring-your-own provider keys, model choices, and whether the next interview is the free demo' },
    { name: 'Profile', description: 'Candidate profile and resume management' },
    { name: 'Interviews', description: 'Interview creation, history, and LiveKit token issuance' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'The Supabase Auth access token: Authorization: Bearer <access_token>',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
        },
      },
      Profile: {
        type: 'object',
        required: ['fullName', 'targetRole', 'experienceLevel', 'yearsExperience', 'skills'],
        properties: {
          fullName: { type: 'string', example: 'Alex Smith' },
          targetRole: { type: 'string', example: 'Full Stack Engineer' },
          experienceLevel: {
            type: 'string',
            enum: ['intern', 'junior', 'mid', 'senior', 'lead'],
            example: 'senior',
          },
          yearsExperience: { type: 'integer', minimum: 0, maximum: 50, example: 5 },
          skills: {
            type: 'array',
            items: { type: 'string' },
            example: ['TypeScript', 'Node.js', 'React'],
          },
          focusAreas: {
            type: 'array',
            items: { type: 'string' },
            example: ['Distributed Systems', 'API Design'],
          },
          linkedinUrl: { type: 'string', format: 'uri', example: 'https://linkedin.com/in/example' },
          githubUrl: { type: 'string', format: 'uri', example: 'https://github.com/example' },
          about: { type: 'string', example: 'Passionate about building scalable systems.' },
        },
      },
      ResumeMeta: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          charCount: { type: 'integer' },
          uploadedAt: { type: 'string', format: 'date-time' },
          preview: { type: 'string' },
        },
      },
      InterviewSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['created', 'in_progress', 'completed', 'failed'] },
          targetRole: { type: 'string', nullable: true },
          experienceLevel: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          endedAt: { type: 'string', format: 'date-time', nullable: true },
          endedBy: { type: 'string', nullable: true },
          overallRating: { type: 'number', nullable: true },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API server health',
        responses: {
          '200': {
            description: 'API is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean', example: true } },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user session and onboarding status',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current session user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    onboarding: {
                      type: 'object',
                      properties: {
                        hasProfile: { type: 'boolean' },
                        hasResume: { type: 'boolean' },
                        complete: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/providers': {
      get: {
        tags: ['Providers'],
        summary: 'Providers, which keys are saved (last 4 only), the model choices, and how the next interview will run',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'entitlement.kind is demo (one free interview), byok (own keys ready) or blocked (with a code and message)' },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/providers/keys/{provider}': {
      put: {
        tags: ['Providers'],
        summary: 'Check a provider API key with the provider, then store it encrypted',
        description: 'Providers: openai, google, groq, deepgram, elevenlabs, cartesia. The key is never returned; only its last 4 characters are.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['apiKey'], properties: { apiKey: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Saved. Includes the models the key can use.' },
          '422': { description: 'The provider rejected the key (code KEY_INVALID)' },
          '502': { description: 'The provider could not be reached (code PROVIDER_UNREACHABLE)' },
          '503': { description: 'Key storage is not configured on this server (code KEYS_NOT_CONFIGURED)' },
        },
      },
      delete: {
        tags: ['Providers'],
        summary: 'Remove a saved key; stages that used it are un-selected',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Removed' } },
      },
    },
    '/api/providers/{provider}/models': {
      get: {
        tags: ['Providers'],
        summary: 'Models available to the saved key, sorted into speech-to-text, language and voice models',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Model lists' }, '404': { description: 'No key saved for this provider (KEY_REQUIRED)' } },
      },
    },
    '/api/providers/selection': {
      put: {
        tags: ['Providers'],
        summary: 'Choose a provider, model and (for voice) voice for each stage',
        description: 'A stage left out is unchanged; null clears it. All three stages must be chosen, each with a saved key, for the next interview to run on the candidate’s own keys.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  stt: { type: 'object', nullable: true, properties: { provider: { type: 'string' }, model: { type: 'string' } } },
                  llm: { type: 'object', nullable: true, properties: { provider: { type: 'string' }, model: { type: 'string' } } },
                  tts: { type: 'object', nullable: true, properties: { provider: { type: 'string' }, model: { type: 'string' }, voice: { type: 'string' } } },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Saved, with the resulting entitlement' }, '400': { description: 'Provider cannot serve that stage, or no key is saved for it' } },
      },
    },
    '/api/profile': {
      get: {
        tags: ['Profile'],
        summary: 'Get candidate profile and uploaded resume metadata',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Profile and resume details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    profile: { $ref: '#/components/schemas/Profile' },
                    resume: { $ref: '#/components/schemas/ResumeMeta' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      put: {
        tags: ['Profile'],
        summary: 'Create or update candidate profile',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Profile' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Profile updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { profile: { $ref: '#/components/schemas/Profile' } },
                },
              },
            },
          },
          '400': { description: 'Validation error' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/profile/resume': {
      post: {
        tags: ['Profile'],
        summary: 'Upload candidate resume (PDF, DOCX, TXT up to 5 MB)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  resume: {
                    type: 'string',
                    format: 'binary',
                    description: 'Resume document file',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Resume uploaded and parsed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { resume: { $ref: '#/components/schemas/ResumeMeta' } },
                },
              },
            },
          },
          '400': { description: 'Missing file or invalid format' },
          '413': { description: 'File exceeds 5 MB limit' },
          '415': { description: 'Unsupported file type' },
        },
      },
      delete: {
        tags: ['Profile'],
        summary: 'Delete uploaded resume',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Resume removed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean', example: true } },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/interviews': {
      get: {
        tags: ['Interviews'],
        summary: 'List user interview history',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of past and active interviews',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    interviews: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/InterviewSummary' },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
      post: {
        tags: ['Interviews'],
        summary: 'Create a new interview session',
        security: [{ bearerAuth: [] }],
        responses: {
          '201': {
            description: 'Interview session created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    interview: { $ref: '#/components/schemas/InterviewSummary' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
          '409': { description: 'Onboarding incomplete (profile or resume missing)' },
        },
      },
    },
    '/api/interviews/{id}': {
      get: {
        tags: ['Interviews'],
        summary: 'Get full interview details, transcript, assessments, and feedback report',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Interview ID',
          },
        ],
        responses: {
          '200': { description: 'Detailed interview object' },
          '404': { description: 'Interview not found' },
        },
      },
    },
    '/api/interviews/{id}/token': {
      post: {
        tags: ['Interviews'],
        summary: 'Generate a LiveKit room token to join the voice interview',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Interview ID',
          },
        ],
        responses: {
          '200': {
            description: 'LiveKit room token and connection details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    serverUrl: { type: 'string' },
                    roomName: { type: 'string' },
                    identity: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': { description: 'Interview not found' },
          '409': { description: 'Interview already in progress or ended' },
        },
      },
    },
  },
};
