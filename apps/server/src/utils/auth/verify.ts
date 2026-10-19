import { z } from "zod";

const identifierSchema = z.union([
  z.string().trim().min(1).max(256),
  z.number().int().nonnegative(),
]).transform(String);
const optionalIdentifierSchema = identifierSchema.nullable().optional();
const educationIdentitySchema = z.object({
  schoolId: optionalIdentifierSchema,
  eduCollege: z.object({ schoolId: optionalIdentifierSchema }).nullable().optional(),
}).nullable().optional();
const identitySchema = z.object({
  status: z.literal(1000),
  data: z.object({
    userInfo: z.object({
      userName: z.string().trim().min(1).max(256),
      userId: identifierSchema,
      sessionId: z.string().trim().min(1).max(4096),
      schoolId: optionalIdentifierSchema,
      eduStudent: educationIdentitySchema,
      eduTeacher: educationIdentitySchema,
    }),
  }),
});
let verificationUrl = "";

export function configureVerification() {
  const value = process.env.EXTERNAL_TOKEN_VERIFICATION_URL;
  if (!value || !URL.canParse(value)) throw new Error("请配置完整的 EXTERNAL_TOKEN_VERIFICATION_URL");
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(process.env.NODE_ENV === "dev" && url.protocol === "http:"))) {
    throw new Error("SXWZ 验证地址必须使用 HTTPS 且不能包含账号或锚点");
  }
  verificationUrl = url.href;
}

export async function verifyExternalToken(token: string) {
  let response: Response;
  try {
    response = await fetch(verificationUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw Object.assign(new Error(timeout ? "SXWZ 验证超时，请稍后重试" : "SXWZ 认证服务暂不可用"), { status: timeout ? 504 : 502 });
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw Object.assign(new Error([401, 403].includes(response.status) ? "SXWZ 登录凭证无效" : "SXWZ 认证服务暂不可用"), { status: [401, 403].includes(response.status) ? 401 : 502 });
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw Object.assign(new Error("SXWZ 认证响应格式无效"), { status: 502 }); }
  const parsed = identitySchema.safeParse(body);
  if (!parsed.success) throw Object.assign(new Error("SXWZ 未返回有效的登录身份"), { status: 401 });
  const userInfo = parsed.data.data.userInfo;
  const nestedSchoolIds = [
    userInfo.eduStudent?.schoolId,
    userInfo.eduStudent?.eduCollege?.schoolId,
    userInfo.eduTeacher?.schoolId,
    userInfo.eduTeacher?.eduCollege?.schoolId,
  ].filter((value): value is string => Boolean(value));
  const distinctNestedSchoolIds = new Set(nestedSchoolIds);
  const schoolId = userInfo.schoolId ?? (distinctNestedSchoolIds.size === 1 ? nestedSchoolIds[0] : undefined);
  return {
    userName: userInfo.userName,
    externalSubject: userInfo.sessionId,
    suanliIdentity: { userId: userInfo.userId, sessionId: userInfo.sessionId, ...(schoolId ? { schoolId } : {}) },
  };
}
