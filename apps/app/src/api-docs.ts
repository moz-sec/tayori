import { z, type OpenAPIHono } from "@hono/zod-openapi";

type OpenAPIRegistry = OpenAPIHono["openAPIRegistry"];

export function registerApiOperations(registry: OpenAPIRegistry) {
  const ErrorResponseSchema = z.object({
    error: z.object({
      code: z.string(),
      requestId: z.string().optional(),
    }),
  });
  const FolderSchema = z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    sortOrder: z.number(),
    unreadCount: z.number().optional(),
  });
  const SourceSchema = z.object({
    id: z.string(),
    folderId: z.string().nullable(),
    title: z.string(),
    siteUrl: z.string().nullable(),
    url: z.string(),
    status: z.enum(["active", "paused", "archived"]),
    intervalMinutes: z.number(),
    nextFetchAt: z.string().datetime(),
    lastCheckedAt: z.string().datetime().nullable(),
    lastSuccessAt: z.string().datetime().nullable(),
    errorCode: z.string().nullable(),
    consecutiveFailures: z.number(),
  });
  const ArticleSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    sourceTitle: z.string(),
    title: z.string(),
    url: z.string(),
    author: z.string().nullable(),
    summary: z.string().nullable(),
    publishedAt: z.string().datetime().nullable(),
    firstSeenAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    read: z.boolean(),
    readAt: z.string().datetime().nullable(),
    starred: z.boolean(),
    readLater: z.boolean(),
    saved: z.boolean(),
    version: z.number(),
  });
  const BoardSchema = z.object({
    id: z.string(),
    name: z.string(),
    sortOrder: z.number(),
    articleCount: z.number().optional(),
  });
  const dataResponse = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
  const jsonResponse = (schema: z.ZodType, description: string) => ({
    description,
    content: { "application/json": { schema } },
  });
  const commonErrorResponses = {
    400: jsonResponse(ErrorResponseSchema, "入力値が不正です。"),
    401: jsonResponse(ErrorResponseSchema, "Cloudflare Access の認証が必要です。"),
    403: jsonResponse(ErrorResponseSchema, "アクセスが許可されていません。"),
    413: jsonResponse(ErrorResponseSchema, "リクエストサイズが上限を超えています。"),
    415: jsonResponse(ErrorResponseSchema, "Content-Type は application/json が必要です。"),
    503: jsonResponse(ErrorResponseSchema, "Cloudflare Access が設定されていません。"),
    500: jsonResponse(ErrorResponseSchema, "内部エラーです。"),
  };
  
  // The existing handlers keep their custom validation and error behavior. These registry entries
  // describe that API without introducing a second validation pass or changing request semantics.
  registry.registerComponent("securitySchemes", "CloudflareAccess", {
    type: "apiKey",
    in: "header",
    name: "Cf-Access-Jwt-Assertion",
    description: "Cloudflare Access が付与するJWT。ブラウザーからの利用では通常自動で付与されます。",
  });
  
  const addOperation = (operation: {
    method: "get" | "post" | "put" | "patch" | "delete";
    path: string;
    summary: string;
    description?: string;
    request?: {
      params?: z.ZodObject;
      query?: z.ZodObject;
      body?: z.ZodType;
    };
    responses: Record<string, { description: string; content?: Record<string, { schema: z.ZodType }> }>;
  }) => {
    registry.registerPath({
      ...operation,
      security: [{ CloudflareAccess: [] }],
      request: {
        ...(operation.request?.params ? { params: operation.request.params } : {}),
        ...(operation.request?.query ? { query: operation.request.query } : {}),
        ...(operation.request?.body
          ? {
              body: {
                required: true,
                content: {
                  "application/json": { schema: operation.request.body },
                },
              },
            }
          : {}),
      },
      responses: { ...commonErrorResponses, ...operation.responses },
    });
  };
  
  const idParams = z.object({
    id: z.string().openapi({
      param: { name: "id", in: "path" },
      example: "folder-uuid",
    }),
  });
  const articleParams = z.object({
    id: z.string().openapi({
      param: { name: "id", in: "path" },
      example: "article-uuid",
    }),
  });
  const boardArticleParams = z.object({
    id: z.string().openapi({
      param: { name: "id", in: "path" },
      example: "board-uuid",
    }),
    articleId: z.string().openapi({
      param: { name: "articleId", in: "path" },
      example: "article-uuid",
    }),
  });
  const emptyResponse = { description: "成功しました。" };
  const emptyBody = z.object({}).openapi("EmptyRequest");
  const nullableIdSchema = z.string().nullable();
  
  addOperation({
    method: "get",
    path: "/health",
    summary: "稼働確認",
    responses: {
      200: jsonResponse(
        dataResponse(z.object({ status: z.literal("ok") })),
        "稼働中です。",
      ),
    },
  });
  addOperation({
    method: "get",
    path: "/me",
    summary: "ログイン中のユーザー",
    responses: {
      200: jsonResponse(
        dataResponse(z.object({ email: z.string().email(), retentionDays: z.number() })),
        "ユーザー情報です。",
      ),
    },
  });
  addOperation({
    method: "get",
    path: "/folders",
    summary: "フォルダ一覧",
    responses: {
      200: jsonResponse(dataResponse(z.array(FolderSchema)), "フォルダ一覧です。"),
    },
  });
  addOperation({
    method: "post",
    path: "/folders",
    summary: "フォルダ作成",
    request: {
      body: z.object({
        name: z.string().min(1).max(100),
        parentId: nullableIdSchema.optional(),
      }),
    },
    responses: {
      201: jsonResponse(dataResponse(FolderSchema), "作成したフォルダです。"),
      409: jsonResponse(ErrorResponseSchema, "同じ階層に同名のフォルダがあります。"),
    },
  });
  addOperation({
    method: "patch",
    path: "/folders/{id}",
    summary: "フォルダ更新",
    request: {
      params: idParams,
      body: z.object({
        name: z.string().min(1).max(100).optional(),
        parentId: nullableIdSchema.optional(),
        sortOrder: z.number().int().min(0).max(100_000).optional(),
      }),
    },
    responses: {
      200: jsonResponse(dataResponse(FolderSchema), "更新後のフォルダです。"),
      404: jsonResponse(ErrorResponseSchema, "フォルダが見つかりません。"),
      409: jsonResponse(ErrorResponseSchema, "名前が重複するか、階層が循環します。"),
    },
  });
  addOperation({
    method: "delete",
    path: "/folders/{id}",
    summary: "フォルダ削除",
    description: "子フォルダと購読先は親フォルダへ移動します。",
    request: { params: idParams },
    responses: {
      204: emptyResponse,
      404: jsonResponse(ErrorResponseSchema, "フォルダが見つかりません。"),
    },
  });
  addOperation({
    method: "get",
    path: "/sources",
    summary: "購読先一覧",
    responses: {
      200: jsonResponse(dataResponse(z.array(SourceSchema)), "購読先一覧です。"),
    },
  });
  
  const sourceInputSchema = z.object({
    url: z.string().url().max(2048),
    folderId: nullableIdSchema.optional(),
    title: z.string().max(100).optional(),
    siteUrl: z.string().url().optional(),
  });
  addOperation({
    method: "post",
    path: "/sources",
    summary: "購読先追加",
    request: { body: sourceInputSchema },
    responses: {
      201: jsonResponse(dataResponse(SourceSchema), "追加した購読先です。"),
      409: jsonResponse(ErrorResponseSchema, "購読先は登録済みです。"),
    },
  });
  addOperation({
    method: "post",
    path: "/sources/import",
    summary: "購読先を一括インポート",
    description: "1回につき最大5件を受け付け、追加・既存・エラーの結果を返します。",
    request: {
      body: z.object({
        sources: z.array(sourceInputSchema).min(1).max(5),
      }),
    },
    responses: {
      200: jsonResponse(
        dataResponse(z.array(z.object({
          status: z.enum(["added", "existing", "error"]),
          source: SourceSchema.optional(),
          code: z.string().optional(),
        }))),
        "各購読先の処理結果です。",
      ),
    },
  });
  addOperation({
    method: "patch",
    path: "/sources/{id}",
    summary: "購読先更新",
    request: {
      params: idParams,
      body: z.object({
        folderId: nullableIdSchema.optional(),
        title: z.string().max(100).optional(),
        status: z.enum(["active", "paused"]).optional(),
      }),
    },
    responses: {
      200: jsonResponse(dataResponse(SourceSchema), "更新後の購読先です。"),
      404: jsonResponse(ErrorResponseSchema, "購読先が見つかりません。"),
    },
  });
  addOperation({
    method: "delete",
    path: "/sources/{id}",
    summary: "購読先をアーカイブ",
    request: { params: idParams },
    responses: {
      204: emptyResponse,
      404: jsonResponse(ErrorResponseSchema, "購読先が見つかりません。"),
    },
  });
  addOperation({
    method: "get",
    path: "/subscriptions.opml",
    summary: "購読先をOPMLで出力",
    responses: {
      200: {
        description: "OPML形式の購読リストです。",
        content: { "application/xml": { schema: z.string() } },
      },
    },
  });
  addOperation({
    method: "get",
    path: "/articles",
    summary: "記事一覧",
    description: "記事一覧の上限は50件です。cursorを使って続きを取得できます。",
    request: {
      query: z.object({
        scope: z.enum(["all", "unread", "read-later", "starred"]).optional(),
        folderId: z.string().optional(),
        sourceId: z.string().optional(),
        boardId: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      }),
    },
    responses: {
      200: jsonResponse(
        z.object({ data: z.array(ArticleSchema), nextCursor: z.string().nullable() }),
        "記事と次ページカーソルです。",
      ),
    },
  });
  addOperation({
    method: "get",
    path: "/articles/{id}",
    summary: "記事詳細",
    request: { params: articleParams },
    responses: {
      200: jsonResponse(dataResponse(ArticleSchema), "記事詳細です。"),
      404: jsonResponse(ErrorResponseSchema, "記事が見つかりません。"),
    },
  });
  addOperation({
    method: "patch",
    path: "/articles/{id}",
    summary: "記事の状態を更新",
    description: "read、starred、readLaterは値で指定します。expectedVersionを指定すると競合を検出できます。",
    request: {
      params: articleParams,
      body: z.object({
        read: z.boolean().optional(),
        starred: z.boolean().optional(),
        readLater: z.boolean().optional(),
        expectedVersion: z.number().int().positive().max(2_147_483_647).optional(),
      }),
    },
    responses: {
      200: jsonResponse(dataResponse(ArticleSchema), "更新後の記事です。"),
      404: jsonResponse(ErrorResponseSchema, "記事が見つかりません。"),
      409: jsonResponse(ErrorResponseSchema, "記事が別の更新で変更されています。"),
    },
  });
  addOperation({
    method: "post",
    path: "/articles/read",
    summary: "記事を一括で既読・未読にする",
    description: "articleIdsは最大50件です。",
    request: {
      body: z.object({ articleIds: z.array(z.string()).max(50), read: z.boolean() }),
    },
    responses: {
      200: jsonResponse(
        dataResponse(z.object({ updated: z.number(), requested: z.number() })),
        "更新件数です。",
      ),
    },
  });
  addOperation({
    method: "get",
    path: "/boards",
    summary: "ボード一覧",
    responses: {
      200: jsonResponse(dataResponse(z.array(BoardSchema)), "ボード一覧です。"),
    },
  });
  addOperation({
    method: "post",
    path: "/boards",
    summary: "ボード作成",
    request: { body: z.object({ name: z.string().min(1).max(100) }) },
    responses: {
      201: jsonResponse(dataResponse(BoardSchema), "作成したボードです。"),
      409: jsonResponse(ErrorResponseSchema, "同名のボードがあります。"),
    },
  });
  addOperation({
    method: "patch",
    path: "/boards/{id}",
    summary: "ボード更新",
    request: {
      params: idParams,
      body: z.object({
        name: z.string().min(1).max(100).optional(),
        sortOrder: z.number().int().min(0).max(100_000).optional(),
      }),
    },
    responses: {
      200: jsonResponse(dataResponse(BoardSchema), "更新後のボードです。"),
      404: jsonResponse(ErrorResponseSchema, "ボードが見つかりません。"),
      409: jsonResponse(ErrorResponseSchema, "同名のボードがあります。"),
    },
  });
  addOperation({
    method: "delete",
    path: "/boards/{id}",
    summary: "ボード削除",
    request: { params: idParams },
    responses: {
      204: emptyResponse,
      404: jsonResponse(ErrorResponseSchema, "ボードが見つかりません。"),
    },
  });
  addOperation({
    method: "put",
    path: "/boards/{id}/articles/{articleId}",
    summary: "記事をボードに保存",
    description: "同じ記事の再登録は成功として扱います。",
    request: { params: boardArticleParams, body: emptyBody },
    responses: {
      204: emptyResponse,
      404: jsonResponse(ErrorResponseSchema, "ボードまたは記事が見つかりません。"),
    },
  });
  addOperation({
    method: "delete",
    path: "/boards/{id}/articles/{articleId}",
    summary: "ボードから記事を解除",
    request: { params: boardArticleParams },
    responses: { 204: emptyResponse },
  });
  addOperation({
    method: "get",
    path: "/status",
    summary: "処理状況",
    responses: {
      200: jsonResponse(
        dataResponse(z.object({
          lastTickAt: z.string().datetime().nullable(),
          activeSources: z.number(),
          failingSources: z.number(),
        })),
        "定期処理と購読先の状況です。",
      ),
    },
  });

}
