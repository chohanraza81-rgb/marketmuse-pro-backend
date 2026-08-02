declare module 'serpapi' {
  export function getJson(params: {
    api_key: string;
    q: string;
    tbm?: string;
    gl?: string;
    num?: number;
    [key: string]: any;
  }): Promise<any>;
}
