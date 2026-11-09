export class ApiError extends Error {
 constructor(message:string,public code:string,public status=0){super(message);this.name='ApiError';}
}
export interface RequestOptions {method?:string;body?:unknown;expectedUserId?:string;expectedSessionEpoch?:number}
