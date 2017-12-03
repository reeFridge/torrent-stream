#[macro_use]
extern crate neon;
extern crate bip_bencode;

use neon::vm::{Call, JsResult, Lock};
use neon::js::{JsString, JsObject, Object, JsInteger, JsUndefined};
use neon::js::binary::JsBuffer;
use neon::mem::Handle;
use neon::scope::RootScope;

use std::io::Write;
use std::default::Default;
use std::ops::DerefMut;
use bip_bencode::{BencodeRef, BRefAccess, BDecodeOpt, BDictAccess, BencodeRefKind};

fn dict_to_js_object(dict: &BDictAccess<&[u8], BencodeRef>, obj: &mut Handle<JsObject>, scope: &mut RootScope) {
    let list = dict.to_list();

    for &(k, v) in list.iter() {
        let key_str = std::str::from_utf8(k).unwrap();

        match v.kind() {
            BencodeRefKind::Bytes(bytes) => {
                match std::str::from_utf8(bytes) {
                    Ok(val_str) => {
                        obj.deref_mut()
                            .set(key_str, JsString::new(scope, val_str).unwrap()).unwrap();
                    },
                    Err(_) => {
                        let mut buffer = JsBuffer::new(scope, bytes.len() as u32).unwrap();

                        buffer.grab(|mut contents| {
                            let mut slice = contents.as_mut_slice();
                            slice.write(bytes).unwrap();
                        });

                        obj.deref_mut()
                            .set(key_str, buffer).unwrap();
                    }
                };
            },
            BencodeRefKind::Int(int) => {
                obj.deref_mut()
                    .set(key_str, JsInteger::new(scope, int as i32)).unwrap();
            },
            BencodeRefKind::List(_) => {
                obj.deref_mut()
                    .set(key_str, JsUndefined::new()).unwrap();
            },
            BencodeRefKind::Dict(dict) => {
                let mut nested_obj = JsObject::new(scope);

                dict_to_js_object(dict, &mut nested_obj, scope);

                obj.deref_mut()
                    .set(key_str, nested_obj).unwrap();
            }
        };
    }
}

fn decode(call: Call) -> JsResult<JsObject> {
    let scope = call.scope;
    let mut input_buffer = call.arguments.require(scope, 0)?.check::<JsBuffer>()?;

    let encode = input_buffer.grab(|data| {
        BencodeRef::decode(data.as_slice(), BDecodeOpt::default()).unwrap()
    });

    let dict = encode.dict().unwrap();

    let mut obj = JsObject::new(scope);
    dict_to_js_object(dict, &mut obj, scope);

    Ok(obj)
}

register_module!(m, {
    m.export("decode", decode)
});
