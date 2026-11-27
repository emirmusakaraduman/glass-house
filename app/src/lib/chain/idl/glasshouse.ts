/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/glasshouse.json`.
 */
export type Glasshouse = {
  "address": "HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2",
  "metadata": {
    "name": "glasshouse",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "GlassHouse: transparent USDC lending pools on Solana"
  },
  "instructions": [
    {
      "name": "applyLoan",
      "discriminator": [
        126,
        185,
        16,
        204,
        134,
        228,
        95,
        21
      ],
      "accounts": [
        {
          "name": "borrower",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "docs": [
            "Satıcı da imzalar (alıcı-satıcı danışıklı işlemine karşı); para satıcıya",
            "ancak confirm_title'da gider."
          ],
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.next_loan_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "borrowerUsdc",
          "writable": true
        },
        {
          "name": "loanEscrow",
          "docs": [
            "Peşinat + açılış ücreti. Authority Pool PDA'sıdır (docs/STATE.md)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "collateralEscrow",
          "docs": [
            "3 taksitlik teminat; LoanEscrow'dan ayrıdır."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "downPayment",
          "type": "u64"
        }
      ]
    },
    {
      "name": "approveLoan",
      "discriminator": [
        223,
        27,
        77,
        138,
        94,
        172,
        21,
        209
      ],
      "accounts": [
        {
          "name": "underwriter",
          "writable": true,
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "borrower",
          "docs": [
            "Reject'te kapatılan hesapların rent'i buraya döner."
          ],
          "writable": true
        },
        {
          "name": "borrowerUsdc",
          "writable": true
        },
        {
          "name": "loanEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "collateralEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "decision",
          "type": {
            "defined": {
              "name": "decision"
            }
          }
        },
        {
          "name": "appraisedValue",
          "type": "u64"
        },
        {
          "name": "docHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "assetRefHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "regionCode",
          "type": "u16"
        },
        {
          "name": "incomeOk",
          "type": "bool"
        },
        {
          "name": "currencyOk",
          "type": "bool"
        }
      ]
    },
    {
      "name": "cancelFunding",
      "docs": [
        "Deadline geçince herkes: anapara vault'a, peşinat + ücret + teminat borçluya."
      ],
      "discriminator": [
        252,
        83,
        32,
        117,
        64,
        229,
        228,
        53
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Herkes çağırabilir; yalnızca tx ücretini öder."
          ],
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "loanEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "collateralEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "borrower",
          "docs": [
            "Kapatılan token hesaplarının rent'i buraya döner."
          ],
          "writable": true
        },
        {
          "name": "borrowerUsdc",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "confirmTitle",
      "docs": [
        "Yalnızca title_agent, deadline öncesi: satıcıya ödeme, ücret bölüşümü, Funded → Active."
      ],
      "discriminator": [
        6,
        244,
        85,
        111,
        193,
        62,
        28,
        97
      ],
      "accounts": [
        {
          "name": "titleAgent",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "loanEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "sellerUsdc",
          "writable": true
        },
        {
          "name": "reserveVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "platformTreasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "crankLoan",
      "docs": [
        "Permissionless: Late1 → Late2 → Defaulted, idempotent."
      ],
      "discriminator": [
        198,
        109,
        222,
        43,
        135,
        82,
        174,
        185
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Herkes çağırabilir; yalnızca tx ücretini öder."
          ],
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "loan"
          ]
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "collateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "platformTreasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createPool",
      "discriminator": [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "arg",
                "path": "params.pool_id"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "platformTreasury",
          "docs": [
            "Açılış ücretinin platform yarısının gideceği USDC hesabı."
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "firstLossVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  105,
                  114,
                  115,
                  116,
                  95,
                  108,
                  111,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "reserveVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "poolParams"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "depositorUsdc",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "depositorShares",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundFirstLoss",
      "discriminator": [
        89,
        24,
        179,
        157,
        49,
        213,
        166,
        60
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "adminTokenAccount",
          "writable": true
        },
        {
          "name": "firstLossVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  105,
                  114,
                  115,
                  116,
                  95,
                  108,
                  111,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundLoan",
      "docs": [
        "Permissionless: koşullar zincirde, para yalnızca vault → LoanEscrow."
      ],
      "discriminator": [
        50,
        221,
        51,
        13,
        3,
        142,
        116,
        215
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Herkes çağırabilir; yalnızca tx ücretini öder."
          ],
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "loanEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "payoff",
      "docs": [
        "Yalnızca borçlu: cezasız erken kapama, teminat iadesi."
      ],
      "discriminator": [
        228,
        189,
        202,
        113,
        120,
        138,
        18,
        234
      ],
      "accounts": [
        {
          "name": "borrower",
          "writable": true,
          "signer": true,
          "relations": [
            "loan"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "loan"
          ]
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "borrowerUsdc",
          "docs": [
            "Ödemenin çıktığı ve teminatın iade edildiği hesap."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "platformTreasury",
          "writable": true
        },
        {
          "name": "collateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "processWithdrawals",
      "docs": [
        "Permissionless: kuyruktan en fazla 3 talep, işlem anındaki NAV ile."
      ],
      "discriminator": [
        16,
        191,
        171,
        40,
        159,
        185,
        239,
        160
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Herkes çağırabilir; yalnızca tx ücretini öder."
          ],
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "shareEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "recordRecovery",
      "docs": [
        "Yalnızca recovery_agent: satış geliri + zarar sırası."
      ],
      "discriminator": [
        53,
        75,
        21,
        95,
        180,
        26,
        115,
        168
      ],
      "accounts": [
        {
          "name": "recoveryAgent",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "coSigner",
          "docs": [
            "Alt sınırın altındaki gelirlerde zorunlu ikinci imza (pool.admin). Gerekmezse verilmez."
          ],
          "signer": true,
          "optional": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "loan"
          ]
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "recoverySource",
          "docs": [
            "Satış gelirinin çıktığı hesap (recovery_agent'ın USDC hesabı)."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "collateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "firstLoss",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  105,
                  114,
                  115,
                  116,
                  95,
                  108,
                  111,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "proceeds",
          "type": "u64"
        }
      ]
    },
    {
      "name": "repay",
      "docs": [
        "Herkes ödeyebilir: gecikme bedeli → faiz → anapara."
      ],
      "discriminator": [
        234,
        103,
        67,
        82,
        208,
        234,
        219,
        166
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          },
          "relations": [
            "loan"
          ]
        },
        {
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "loan.id",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "payerUsdc",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "platformTreasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "requestWithdraw",
      "docs": [
        "Pay sahibi: çekim talebi açar, payları kilitler."
      ],
      "discriminator": [
        137,
        95,
        187,
        96,
        250,
        138,
        31,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.admin",
                "account": "pool"
              },
              {
                "kind": "account",
                "path": "pool.pool_id",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "ownerShares",
          "writable": true
        },
        {
          "name": "destination",
          "docs": [
            "Ödemenin gideceği USDC hesabı; talepte sabitlenir."
          ]
        },
        {
          "name": "shareEscrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "withdrawRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  114,
                  101,
                  113
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "pool.withdraw_tail",
                "account": "pool"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "loan",
      "discriminator": [
        20,
        195,
        70,
        117,
        165,
        227,
        182,
        1
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "withdrawRequest",
      "discriminator": [
        186,
        239,
        174,
        191,
        189,
        13,
        47,
        196
      ]
    }
  ],
  "events": [
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "firstLossFunded",
      "discriminator": [
        195,
        8,
        150,
        92,
        238,
        108,
        173,
        127
      ]
    },
    {
      "name": "fundingCancelled",
      "discriminator": [
        101,
        238,
        217,
        103,
        110,
        16,
        93,
        20
      ]
    },
    {
      "name": "loanApplied",
      "discriminator": [
        22,
        64,
        78,
        220,
        176,
        61,
        27,
        98
      ]
    },
    {
      "name": "loanApproved",
      "discriminator": [
        200,
        165,
        55,
        199,
        125,
        213,
        4,
        243
      ]
    },
    {
      "name": "loanCranked",
      "discriminator": [
        93,
        82,
        225,
        10,
        162,
        24,
        210,
        94
      ]
    },
    {
      "name": "loanFunded",
      "discriminator": [
        94,
        180,
        111,
        215,
        102,
        39,
        198,
        83
      ]
    },
    {
      "name": "loanPaidOff",
      "discriminator": [
        114,
        134,
        68,
        131,
        51,
        24,
        131,
        251
      ]
    },
    {
      "name": "loanRejected",
      "discriminator": [
        121,
        124,
        57,
        222,
        3,
        162,
        201,
        212
      ]
    },
    {
      "name": "loanRepaid",
      "discriminator": [
        202,
        183,
        88,
        60,
        211,
        54,
        142,
        243
      ]
    },
    {
      "name": "poolCreated",
      "discriminator": [
        202,
        44,
        41,
        88,
        104,
        220,
        157,
        82
      ]
    },
    {
      "name": "recoveryRecorded",
      "discriminator": [
        38,
        18,
        5,
        99,
        23,
        64,
        59,
        246
      ]
    },
    {
      "name": "titleConfirmed",
      "discriminator": [
        246,
        22,
        39,
        187,
        31,
        88,
        131,
        110
      ]
    },
    {
      "name": "withdrawProcessed",
      "discriminator": [
        234,
        53,
        39,
        68,
        158,
        177,
        195,
        13
      ]
    },
    {
      "name": "withdrawRequested",
      "discriminator": [
        114,
        16,
        240,
        206,
        93,
        128,
        151,
        39
      ]
    },
    {
      "name": "withdrawSkipped",
      "discriminator": [
        26,
        65,
        142,
        111,
        35,
        78,
        107,
        43
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Caller is not authorized for this action"
    },
    {
      "code": 6001,
      "name": "invalidStatus",
      "msg": "Loan or pool is not in the required status"
    },
    {
      "code": 6002,
      "name": "sellerIsBorrower",
      "msg": "Seller must differ from borrower"
    },
    {
      "code": 6003,
      "name": "insufficientDownPayment",
      "msg": "Down payment is below the minimum required by max LTV"
    },
    {
      "code": 6004,
      "name": "appraisalTooLow",
      "msg": "Principal exceeds max LTV on min(price, appraised value)"
    },
    {
      "code": 6005,
      "name": "liquidityBufferBreached",
      "msg": "Funding would breach the liquidity buffer"
    },
    {
      "code": 6006,
      "name": "brakeLateRatio",
      "msg": "Late/default ratio is above the brake threshold"
    },
    {
      "code": 6007,
      "name": "brakeReserve",
      "msg": "Reserve is below the brake threshold"
    },
    {
      "code": 6008,
      "name": "insufficientFirstLoss",
      "msg": "First-loss vault is below the required minimum"
    },
    {
      "code": 6009,
      "name": "paramOutOfBounds",
      "msg": "Pool parameter is out of the allowed bounds"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6011,
      "name": "titleDeadlinePassed",
      "msg": "Title confirmation deadline has passed"
    },
    {
      "code": 6012,
      "name": "titleDeadlineNotReached",
      "msg": "Title confirmation deadline has not been reached yet"
    },
    {
      "code": 6013,
      "name": "invariantViolation",
      "msg": "Accounting invariant violated"
    },
    {
      "code": 6014,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6015,
      "name": "loanNotServiceable",
      "msg": "Loan is not in a status that allows this action"
    },
    {
      "code": 6016,
      "name": "periodAlreadyProcessed",
      "msg": "This period has already been processed for the loan"
    },
    {
      "code": 6017,
      "name": "recoveryBelowFloor",
      "msg": "Recovery proceeds are below the required floor"
    },
    {
      "code": 6018,
      "name": "withdrawQueueEmpty",
      "msg": "Withdraw queue is empty"
    },
    {
      "code": 6019,
      "name": "invalidWithdrawRequest",
      "msg": "Withdraw request is invalid or out of order"
    },
    {
      "code": 6020,
      "name": "insufficientIdleCash",
      "msg": "Not enough idle cash for this action"
    },
    {
      "code": 6021,
      "name": "invalidPaymentAmount",
      "msg": "Payment amount is invalid"
    },
    {
      "code": 6022,
      "name": "invalidCoSigner",
      "msg": "Co-signer is missing or invalid"
    }
  ],
  "types": [
    {
      "name": "assetType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "house"
          },
          {
            "name": "vehicle"
          }
        ]
      }
    },
    {
      "name": "decision",
      "docs": [
        "Tek karar girdisi: approve_loan(decision, ...)"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "approve"
          },
          {
            "name": "reject"
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "sharesMinted",
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "seniorNav",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "firstLossFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "firstLossBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fundingCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "returnedToVault",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loan",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "appraisedValue",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "rateBps",
            "type": "u16"
          },
          {
            "name": "installment",
            "type": "u64"
          },
          {
            "name": "remainingPrincipal",
            "type": "u64"
          },
          {
            "name": "paidInstallments",
            "type": "u16"
          },
          {
            "name": "missedInstallments",
            "type": "u16"
          },
          {
            "name": "nextDue",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "loanStatus"
              }
            }
          },
          {
            "name": "docHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetRefHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "valueBand",
            "type": "u64"
          },
          {
            "name": "regionCode",
            "type": "u16"
          },
          {
            "name": "incomeOk",
            "type": "bool"
          },
          {
            "name": "currencyOk",
            "type": "bool"
          },
          {
            "name": "provisionAmount",
            "type": "u64"
          },
          {
            "name": "lateFeeAccrued",
            "type": "u64"
          },
          {
            "name": "lastProcessedPeriod",
            "type": "u64"
          },
          {
            "name": "fundedAt",
            "type": "i64"
          },
          {
            "name": "titleDeadline",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "escrowBump",
            "type": "u8"
          },
          {
            "name": "collateralBump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "loanApplied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "installment",
            "type": "u64"
          },
          {
            "name": "escrowAmount",
            "type": "u64"
          },
          {
            "name": "collateralAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loanApproved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "appraisedValue",
            "type": "u64"
          },
          {
            "name": "valueBand",
            "type": "u64"
          },
          {
            "name": "regionCode",
            "type": "u16"
          },
          {
            "name": "docHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetRefHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "loanCranked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "cranker",
            "type": "pubkey"
          },
          {
            "name": "oldStatus",
            "type": "u8"
          },
          {
            "name": "newStatus",
            "type": "u8"
          },
          {
            "name": "missedInstallments",
            "type": "u16"
          },
          {
            "name": "collateralUsed",
            "type": "u64"
          },
          {
            "name": "provisionAmount",
            "type": "u64"
          },
          {
            "name": "provisionDelta",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "loanFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "titleDeadline",
            "type": "i64"
          },
          {
            "name": "idleCash",
            "type": "u64"
          },
          {
            "name": "totalOutstanding",
            "type": "u64"
          },
          {
            "name": "reservePending",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loanPaidOff",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "collateralReturned",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loanRejected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loanRepaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "lateFee",
            "type": "u64"
          },
          {
            "name": "interest",
            "type": "u64"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "remainingPrincipal",
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Durum (LoanStatus indeksi) ödeme sonrası."
            ],
            "type": "u8"
          },
          {
            "name": "nextDue",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "loanStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "approved"
          },
          {
            "name": "rejected"
          },
          {
            "name": "funded"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "active"
          },
          {
            "name": "late1"
          },
          {
            "name": "late2"
          },
          {
            "name": "defaulted"
          },
          {
            "name": "recovered"
          },
          {
            "name": "paidOff"
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "assetType",
            "type": {
              "defined": {
                "name": "assetType"
              }
            }
          },
          {
            "name": "underwriter",
            "type": "pubkey"
          },
          {
            "name": "titleAgent",
            "type": "pubkey"
          },
          {
            "name": "recoveryAgent",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "platformTreasury",
            "docs": [
              "Açılış ücretinin platform yarısının gideceği USDC hesabı."
            ],
            "type": "pubkey"
          },
          {
            "name": "poolId",
            "type": "u64"
          },
          {
            "name": "maxLtvBps",
            "type": "u16"
          },
          {
            "name": "rateBps",
            "type": "u16"
          },
          {
            "name": "termMonths",
            "type": "u16"
          },
          {
            "name": "recoveryCoeffBps",
            "type": "u16"
          },
          {
            "name": "graceSeconds",
            "type": "i64"
          },
          {
            "name": "periodSeconds",
            "type": "i64"
          },
          {
            "name": "provisionBps",
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "bufferBps",
            "type": "u16"
          },
          {
            "name": "brakeLateBps",
            "type": "u16"
          },
          {
            "name": "brakeReserveBps",
            "type": "u16"
          },
          {
            "name": "minFirstLossBps",
            "type": "u16"
          },
          {
            "name": "entryExitFeeBps",
            "type": "u16"
          },
          {
            "name": "minRecoveryBps",
            "type": "u16"
          },
          {
            "name": "titleTimeoutSeconds",
            "type": "i64"
          },
          {
            "name": "nextLoanId",
            "type": "u64"
          },
          {
            "name": "idleCash",
            "type": "u64"
          },
          {
            "name": "totalOutstanding",
            "type": "u64"
          },
          {
            "name": "lateDefaultPrincipal",
            "type": "u64"
          },
          {
            "name": "lossProvision",
            "type": "u64"
          },
          {
            "name": "firstLossBalance",
            "type": "u64"
          },
          {
            "name": "reserveBalance",
            "type": "u64"
          },
          {
            "name": "reservePending",
            "docs": [
              "Fonlanmış ama tescili onaylanmamış kredilerin yedek fon payı. Yalnızca fren",
              "hesabında kullanılır, NAV'a girmez (karar 1)."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "withdrawHead",
            "docs": [
              "Çekim kuyruğu (Kişi 2)."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawTail",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "poolStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "firstLossBump",
            "type": "u8"
          },
          {
            "name": "reserveBump",
            "type": "u8"
          },
          {
            "name": "shareMintBump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "assetType",
            "type": "u8"
          },
          {
            "name": "maxLtvBps",
            "type": "u16"
          },
          {
            "name": "rateBps",
            "type": "u16"
          },
          {
            "name": "termMonths",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "poolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolId",
            "type": "u64"
          },
          {
            "name": "assetType",
            "type": {
              "defined": {
                "name": "assetType"
              }
            }
          },
          {
            "name": "underwriter",
            "type": "pubkey"
          },
          {
            "name": "titleAgent",
            "type": "pubkey"
          },
          {
            "name": "recoveryAgent",
            "type": "pubkey"
          },
          {
            "name": "maxLtvBps",
            "type": "u16"
          },
          {
            "name": "rateBps",
            "type": "u16"
          },
          {
            "name": "termMonths",
            "type": "u16"
          },
          {
            "name": "recoveryCoeffBps",
            "type": "u16"
          },
          {
            "name": "graceSeconds",
            "type": "i64"
          },
          {
            "name": "periodSeconds",
            "type": "i64"
          },
          {
            "name": "provisionBps",
            "docs": [
              "[Active, Late1, Late2, Defaulted-taban]; azalmayan, ≤ 10000."
            ],
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "bufferBps",
            "type": "u16"
          },
          {
            "name": "brakeLateBps",
            "type": "u16"
          },
          {
            "name": "brakeReserveBps",
            "type": "u16"
          },
          {
            "name": "minFirstLossBps",
            "type": "u16"
          },
          {
            "name": "entryExitFeeBps",
            "type": "u16"
          },
          {
            "name": "minRecoveryBps",
            "type": "u16"
          },
          {
            "name": "titleTimeoutSeconds",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "paused"
          }
        ]
      }
    },
    {
      "name": "recoveryRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "proceeds",
            "type": "u64"
          },
          {
            "name": "collateralUsed",
            "type": "u64"
          },
          {
            "name": "loss",
            "type": "u64"
          },
          {
            "name": "firstLossUsed",
            "type": "u64"
          },
          {
            "name": "reserveUsed",
            "type": "u64"
          },
          {
            "name": "seniorLoss",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "titleConfirmed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "loanId",
            "type": "u64"
          },
          {
            "name": "paidToSeller",
            "type": "u64"
          },
          {
            "name": "reserveBalance",
            "type": "u64"
          },
          {
            "name": "nextDue",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawProcessed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "net",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawRequest",
      "docs": [
        "Tek bir çekim talebi. Paylar `share_escrow`'a kilitlenir; process_withdrawals FIFO sırayla",
        "işlem anındaki NAV ile öder, payları yakar ve hesabı kapatır (kira `owner`'a döner)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "docs": [
              "Ödemenin gideceği USDC token hesabı (talep anında sabitlenir)."
            ],
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawSkipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "request",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
