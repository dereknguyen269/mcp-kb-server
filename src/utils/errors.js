import logger from './logger.js';

export class AppError extends Error {
  constructor(message, code = -32000, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, -32602, 400);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends AppError {
  constructor(message, originalError) {
    super(message, -32000, 500);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

export class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`, -32601, 404);
    this.name = 'NotFoundError';
  }
}

export function handleError(error, context = {}) {
  // Log the error with context
  logger.error('Error occurred', {
    message: error.message,
    name: error.name,
    code: error.code,
    stack: error.stack,
    context,
    isOperational: error.isOperational
  });

  // Return appropriate JSON-RPC error
  if (error.isOperational) {
    return {
      code: error.code,
      message: error.message
    };
  }

  // For unexpected errors, don't expose internal details
  return {
    code: -32000,
    message: 'Internal server error'
  };
}

export function wrapAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw error.isOperational ? error : new AppError('Unexpected error occurred');
    }
  };
}

export function retryOperation(operation, maxRetries = 3, delay = 1000) {
  return async (...args) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation(...args);
      } catch (error) {
        lastError = error;
        
        // Don't retry validation errors or operational errors
        if (error.isOperational && error.code === -32602) {
          throw error;
        }
        
        if (attempt === maxRetries) {
          logger.error(`Operation failed after ${maxRetries} attempts`, {
            error: error.message,
            attempts: maxRetries
          });
          break;
        }
        
        logger.warn(`Operation failed, retrying (${attempt}/${maxRetries})`, {
          error: error.message,
          nextRetryIn: delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Exponential backoff
      }
    }
    
    throw lastError;
  };
}
