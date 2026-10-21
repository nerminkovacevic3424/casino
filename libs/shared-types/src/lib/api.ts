/** Error body returned by every API endpoint. */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  /** Correlates with server logs and traces. */
  readonly requestId?: string;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
