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
    { name: 'Auth', description: 'User registration, login, session validation' },
    { name: 'Profile', description: 'Candidate profile and resume management' },
    { name: 'Interviews', description: 'Interview creation, history, and LiveKit token issuance' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'vi_token',
        description: 'JWT session cookie set on login/signup',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Optional Authorization Bearer token header',
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
    '/api/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Jane Doe' },
                  email: { type: 'string', format: 'email', example: 'jane@example.com' },
                  password: { type: 'string', format: 'password', minLength: 8, example: 'secret1234' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Account created and session cookie issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Email already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'jane@example.com' },
                  password: { type: 'string', format: 'password', example: 'secret1234' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated successfully and session cookie issued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
          '401': { description: 'Invalid email or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Clear user session cookie',
        responses: {
          '200': {
            description: 'Logged out successfully',
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
    '/api/profile': {
      get: {
        tags: ['Profile'],
        summary: 'Get candidate profile and uploaded resume metadata',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
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
