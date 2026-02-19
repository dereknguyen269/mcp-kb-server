import { test } from "node:test";
import assert from "node:assert";
import { AppError, ValidationError, DatabaseError, handleError, wrapAsync, retryOperation } from "../src/utils/errors.js";

test("AppError creates operational error with code", () => {
  const error = new AppError("Test error", -32001, 400);
  
  assert.equal(error.message, "Test error");
  assert.equal(error.code, -32001);
  assert.equal(error.statusCode, 400);
  assert.equal(error.isOperational, true);
});

test("ValidationError has correct defaults", () => {
  const error = new ValidationError("Invalid input");
  
  assert.equal(error.code, -32602);
  assert.equal(error.statusCode, 400);
  assert.equal(error.isOperational, true);
});

test("handleError returns appropriate JSON-RPC error", () => {
  const operationalError = new AppError("Known error", -32001);
  const result = handleError(operationalError, { method: "test" });
  
  assert.equal(result.code, -32001);
  assert.equal(result.message, "Known error");
});

test("handleError masks unexpected errors", () => {
  const unexpectedError = new Error("Internal system error");
  const result = handleError(unexpectedError);
  
  assert.equal(result.code, -32000);
  assert.equal(result.message, "Internal server error");
});

test("wrapAsync converts unexpected errors to AppError", async () => {
  const throwingFunction = async () => {
    throw new Error("Unexpected error");
  };
  
  const wrapped = wrapAsync(throwingFunction);
  
  try {
    await wrapped();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.name, "AppError");
    assert.equal(error.isOperational, true);
  }
});

test("retryOperation retries on failure", async () => {
  let attempts = 0;
  const flakyOperation = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error("Temporary failure");
    }
    return "success";
  };
  
  const retryingOperation = retryOperation(flakyOperation, 3, 10);
  const result = await retryingOperation();
  
  assert.equal(result, "success");
  assert.equal(attempts, 3);
});

test("retryOperation doesn't retry validation errors", async () => {
  let attempts = 0;
  const validationFailure = async () => {
    attempts++;
    throw new ValidationError("Invalid input");
  };
  
  const retryingOperation = retryOperation(validationFailure, 3, 10);
  
  try {
    await retryingOperation();
    assert.fail("Should have thrown");
  } catch (error) {
    assert.equal(error.name, "ValidationError");
    assert.equal(attempts, 1); // Should not retry
  }
});
