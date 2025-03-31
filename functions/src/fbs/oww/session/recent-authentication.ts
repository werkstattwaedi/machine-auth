// automatically generated by the FlatBuffers compiler, do not modify

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import * as flatbuffers from 'flatbuffers';



export class RecentAuthentication implements flatbuffers.IUnpackableObject<RecentAuthenticationT> {
  bb: flatbuffers.ByteBuffer|null = null;
  bb_pos = 0;
  __init(i:number, bb:flatbuffers.ByteBuffer):RecentAuthentication {
  this.bb_pos = i;
  this.bb = bb;
  return this;
}

static getRootAsRecentAuthentication(bb:flatbuffers.ByteBuffer, obj?:RecentAuthentication):RecentAuthentication {
  return (obj || new RecentAuthentication()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

static getSizePrefixedRootAsRecentAuthentication(bb:flatbuffers.ByteBuffer, obj?:RecentAuthentication):RecentAuthentication {
  bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
  return (obj || new RecentAuthentication()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
}

token():string|null
token(optionalEncoding:flatbuffers.Encoding):string|Uint8Array|null
token(optionalEncoding?:any):string|Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? this.bb!.__string(this.bb_pos + offset, optionalEncoding) : null;
}

static startRecentAuthentication(builder:flatbuffers.Builder) {
  builder.startObject(1);
}

static addToken(builder:flatbuffers.Builder, tokenOffset:flatbuffers.Offset) {
  builder.addFieldOffset(0, tokenOffset, 0);
}

static endRecentAuthentication(builder:flatbuffers.Builder):flatbuffers.Offset {
  const offset = builder.endObject();
  return offset;
}

static createRecentAuthentication(builder:flatbuffers.Builder, tokenOffset:flatbuffers.Offset):flatbuffers.Offset {
  RecentAuthentication.startRecentAuthentication(builder);
  RecentAuthentication.addToken(builder, tokenOffset);
  return RecentAuthentication.endRecentAuthentication(builder);
}

serialize():Uint8Array {
  return this.bb!.bytes();
}

static deserialize(buffer: Uint8Array):RecentAuthentication {
  return RecentAuthentication.getRootAsRecentAuthentication(new flatbuffers.ByteBuffer(buffer))
}

unpack(): RecentAuthenticationT {
  return new RecentAuthenticationT(
    this.token()
  );
}


unpackTo(_o: RecentAuthenticationT): void {
  _o.token = this.token();
}
}

export class RecentAuthenticationT implements flatbuffers.IGeneratedObject {
constructor(
  public token: string|Uint8Array|null = null
){}


pack(builder:flatbuffers.Builder): flatbuffers.Offset {
  const token = (this.token !== null ? builder.createString(this.token!) : 0);

  return RecentAuthentication.createRecentAuthentication(builder,
    token
  );
}
}
