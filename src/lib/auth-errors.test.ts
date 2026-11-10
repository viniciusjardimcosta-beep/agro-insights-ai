import { describe, expect, it } from "vitest";
import { GENERIC_AUTH_ERROR, isExistingAccountSignUp, translateAuthError } from "@/lib/auth-errors";

describe("translateAuthError", () => {
  it("login inválido", () => {
    expect(translateAuthError("Invalid login credentials")).toBe("E-mail ou senha incorretos.");
  });
  it("e-mail não confirmado", () => {
    expect(translateAuthError("Email not confirmed")).toMatch(/Confirme seu e-mail/);
  });
  it("já cadastrado", () => {
    expect(translateAuthError("User already registered")).toMatch(/já está cadastrado/);
  });
  it("senha curta usa o número da mensagem", () => {
    expect(translateAuthError("Password should be at least 8 characters.")).toBe("A senha deve ter pelo menos 8 caracteres.");
  });
  it("senha fraca", () => {
    expect(translateAuthError("Password is known to be weak and easy to guess, please choose a different one.")).toMatch(/Senha fraca/);
  });
  it("limite de tentativas", () => {
    expect(translateAuthError("For security purposes, you can only request this after 45 seconds.")).toMatch(/Muitas tentativas/);
  });
  it("sem conexão", () => {
    expect(translateAuthError("Failed to fetch")).toMatch(/Sem conexão/);
  });
  it("desconhecido ou vazio: texto genérico, nunca o original", () => {
    expect(translateAuthError("some internal error xyz")).toBe(GENERIC_AUTH_ERROR);
    expect(translateAuthError("")).toBe(GENERIC_AUTH_ERROR);
    expect(translateAuthError(undefined)).toBe(GENERIC_AUTH_ERROR);
  });
});

describe("isExistingAccountSignUp", () => {
  it("reconhece e-mail já cadastrado (usuário sem identidades)", () => {
    expect(isExistingAccountSignUp({ user: { identities: [] }, session: null })).toBe(true);
  });
  it("cadastro novo tem identidade", () => {
    expect(isExistingAccountSignUp({ user: { identities: [{ id: "x" }] }, session: null })).toBe(false);
  });
  it("sem informação de identidades não assume duplicado", () => {
    expect(isExistingAccountSignUp({ user: {} })).toBe(false);
    expect(isExistingAccountSignUp({ user: null })).toBe(false);
    expect(isExistingAccountSignUp(null)).toBe(false);
  });
});
