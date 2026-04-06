declare module 'pg' {
  export class Pool {
    constructor(config?: any)
    connect(): Promise<any>
    query(sql: string, params?: any[]): Promise<any>
    end(): Promise<void>
  }

  const pg: {
    Pool: typeof Pool
  }

  export default pg
}
