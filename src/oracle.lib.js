const oracledb = require('oracledb')
const async = require('async')
let pool,
    buildupScripts = [],
    teardownScripts = []

module.exports.OBJECT = oracledb.OBJECT

let dbConfig = undefined
async function initDB({ user, password, connectString, isPool = 'n/a' }) {
    dbConfig = { user, password, connectString, isPool: isPool.trim().toLowerCase() === 'true' }

    dbConfig.pool = undefined
    if (dbConfig.isPool) {
        dbConfig.pool = await createPool()
    }

    //return dbConfig
}
module.exports.initDB = initDB

// Create connection pooling
async function createPool() {
    return new Promise(async (resolve, reject) => {
        await oracledb.createPool(dbConfig, (err, p) => {
            if (err) {
                reject(err)
            }
            //dbConfig.pool = p
            resolve(p)
        })
    })
}
module.exports.createPool = createPool

async function terminatePool() {
    return new Promise(async (resolve, reject) => {
        if (dbConfig.pool) {
            dbConfig.pool.terminate((err) => {
                reject(err)
            })
            resolve()
        } else {
            resolve()
        }
    })
}
module.exports.terminatePool = terminatePool

// async function getPool() {
//     return pool
// }
// module.exports.getPool = getPool

async function addBuildupSql(statement) {
    const stmt = {
        sql: statement.sql,
        binds: statement.binds || {},
        options: statement.options || {},
    }
    buildupScripts.push(stmt)
}
module.exports.addBuidupSql = addBuildupSql

async function addTeardownSql(statement) {
    const stmt = {
        sql: statement.sql,
        binds: statement.binds || {},
        options: statement.options || {},
    }
    teardownScripts.push(stmt)
}
module.exports.addTeardownSql = addTeardownSql

// Perform execute
async function execute(sql, bindParams, options, connection) {
    return new Promise(async (resolve, reject) => {
        // Query
        connection
            .execute(sql, bindParams, options)
            .then((res) => {
                resolve(res)
            })
            .catch((e) => {
                reject(e)
            })
    })
}
module.exports.execute = execute

// Get connection pool
async function getConnectionPool() {
    if (dbConfig.pool === undefined) {
        // console.log('Creating new pool')
        dbConfig.pool = await createPool()
    }

    return new Promise(async (resolve, reject) => {
        dbConfig.pool
            .getConnection()
            .then((conn) => {
                async.eachSeries(
                    buildupScripts,
                    (statement, callback) => {
                        //console.log('In each series')
                        execute(statement.sql, statement.binds, statement.options, conn)
                            .then((res) => {
                                //console.log(res)
                                callback(null)
                            })
                            .catch((e) => {
                                //console.log(e)
                                callback(e)
                            })
                    },
                    (err, res) => {
                        if (err) {
                            reject(err)
                        }
                        resolve(conn)
                    }
                )
            })
            .catch((e) => {
                reject(e)
            })
    })
}
module.exports.getConnectionPool = getConnectionPool

function releaseConnection(connection) {
    async.eachSeries(
        teardownScripts,
        (statement, callback) => {
            //console.log('In each series')
            execute(statement.sql, statement.binds, statement.options, conn)
                .then((res) => {
                    //console.log(res)
                    callback(undefined)
                })
                .catch((e) => {
                    //console.log(e)
                    callback(e)
                })
        },
        (err, res) => {
            if (err) {
                //console.log(err)
                reject(err)
            }
            connection.release((err) => {
                if (err) {
                    console.log('Releasing connection error:', err)
                } else {
                    //console.log("Connection released")
                }
            })
        }
    )
}

// Simple execute
async function executeQuery(sql, bindParams = {}, options = {}) {
    console.log('sql :', sql)
    console.log('bindParams :', bindParams)

    try {
        // Add out format
        options = { outFormat: oracledb.OUT_FORMAT_OBJECT } || options

        if (dbConfig.isPool) {
            return new Promise(async (resolve, reject) => {
                getConnectionPool()
                    .then((connection) => {
                        execute(sql, bindParams, options, connection)
                            .then((res) => {
                                //console.log('Debug : Hello')
                                // Remove RNUM
                                res.rows = res.rows.map((d) => {
                                    delete d['RNUM']
                                    return d
                                })
                                resolve(res.rows)

                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                            .catch((e) => {
                                //console.log('Debug : error', JSON.stringify(e))
                                reject(e)
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                    })
                    .catch((e) => {
                        console.log('Error', e)

                        reject(e)
                    })
            })
        } else {
            return new Promise(async (resolve, reject) => {
                oracledb
                    .getConnection(dbConfig)
                    .then((connection) => {
                        execute(sql, bindParams, options, connection)
                            .then((res) => {
                                //console.log(res.rows)
                                // Remove RNUM
                                res.rows = res.rows.map((d) => {
                                    delete d['RNUM']
                                    return d
                                })

                                resolve(res.rows)

                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                            .catch((e) => {
                                reject(e)
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                    })
                    .catch((e) => {
                        throw e
                        //throw new Error(e)
                    })
            })
        }
    } catch (e) {
        throw e
        //throw new Error(e)
    }
}
module.exports.executeQuery = executeQuery

// Execute Update
async function executeNonQuery(sql, bindParams = {}, options = {}) {
    try {
        // Options
        options.isAutoCommit = true
        if (dbConfig.isPool) {
            return new Promise(async (resolve, reject) => {
                getConnectionPool()
                    .then((connection) => {
                        //console.log("connection", connection)

                        execute(sql, bindParams, options, connection)
                            .then((res) => {
                                if (res) {
                                    connection
                                        .commit()
                                        .then((res) => {
                                            resolve(res)
                                        })
                                        .catch((e) => {
                                            throw e
                                        })
                                    resolve(res)
                                } else {
                                    reject('Nothing updated')
                                }
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                            .catch((e) => {
                                reject(e)
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                    })
                    .catch((e) => {
                        //console.log('Error', e)

                        reject(e)
                    })
            })
        } else {
            return new Promise(async (resolve, reject) => {
                let connection
                try {
                    //console.log(dbConfig)
                    //oracledb.autoCommit = true
                    connection = oracledb.getConnection(dbConfig)
                    //console.log(connection)
                    let result = await (await connection).execute(sql, bindParams, options)

                    // For executing update
                    if (result) {
                        // Commit update
                        ;(await connection)
                            .commit()
                            .then((res) => {
                                resolve(res)
                            })
                            .catch((e) => {
                                console.log(e)
                            })
                    } else {
                        reject('Nothing updated')
                    }
                    //console.log(result)
                    //resolve(result)
                } catch (e) {
                    console.log(e)
                    reject(e)
                } finally {
                    ;(await connection).release()
                }
            })
        }
    } catch (e) {
        throw e
        //throw new Error(e)
    }
}
module.exports.executeNonQuery = executeNonQuery

async function executeScalar(sql, bindParams = {}, options = {}) {
    try {
        // Add out format
        options = { outFormat: oracledb.OUT_FORMAT_OBJECT } || options

        if (dbConfig.isPool) {
            //console.log("Executing using pool")

            return new Promise(async (resolve, reject) => {
                getConnectionPool()
                    .then((connection) => {
                        execute(sql, bindParams, options, connection)
                            .then((res) => {
                                resolve(res.rows[0][Object.keys(res.rows[0])])

                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                            .catch((e) => {
                                reject(e)
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                    })
                    .catch((e) => {
                        console.log('Error', e)

                        reject(e)
                    })
            })
        } else {
            //console.log("Executing without pool")
            // Executing without oracle pool
            return new Promise(async (resolve, reject) => {
                //let connection
                try {
                    oracledb
                        .getConnection(dbConfig)
                        .then((connection) => {
                            execute(sql, bindParams, options, connection)
                                .then((res) => {
                                    resolve(res.rows[0][Object.keys(res.rows[0])])

                                    process.nextTick(() => {
                                        releaseConnection(connection)
                                    })
                                })
                                .catch((e) => {
                                    reject(e)
                                    process.nextTick(() => {
                                        releaseConnection(connection)
                                    })
                                })
                        })
                        .catch((e) => {
                            throw e
                            //throw new Error(e)
                        })

                    //let res = await (await connection).execute(sql, bindParams, options)

                    //resolve(res.rows[0][Object.keys(res.rows[0])])
                } catch (e) {
                    console.log(e)
                    reject(e)
                }
                // finally {
                //     //console.log('Releasing connection')
                //     //;(await connection).release()
                // }
            })
        }
    } catch (e) {
        throw e
        //throw new Error(e)
    }
}
module.exports.executeScalar = executeScalar

// Execute Paging data
async function executePaging(sql, paging, bindParams = {}, options = {}) {
    try {
        if (!sql || sql.trim().length === 0) {
            throw new Error('No sql command specified')
        }

        // Add out format
        options = { outFormat: oracledb.OUT_FORMAT_OBJECT } || options
        sql = sql.trim().toUpperCase()

        let sqlPaging = `
            SELECT B.* FROM (
                SELECT
                row_number() over (ORDER BY ${paging.sort}) rnum,
                A.* from (${sql}) A
            ) B WHERE rnum BETWEEN ${paging.row_start} AND ${paging.row_end}  ORDER BY rnum
            `
        let sqlCount = `select count(*) FROM (${sql})`

        if (dbConfig.isPool) {
            //console.log("Executing using pool")

            return new Promise(async (resolve, reject) => {
                getConnectionPool()
                    .then((connection) => {
                        let data, count
                        data = execute(sqlPaging, bindParams, options, connection)
                            .then((res) => {
                                data = res.rows

                                // Remove RNUM
                                data = data.map((d) => {
                                    delete d['RNUM']
                                    return d
                                })

                                execute(sqlCount, bindParams, options, connection)
                                    .then((res) => {
                                        count = res.rows[0][Object.keys(res.rows[0])]
                                        paging.count = count

                                        resolve({ data, paging })

                                        process.nextTick(() => {
                                            releaseConnection(connection)
                                        })
                                    })
                                    .catch((e) => {
                                        reject(e)
                                        process.nextTick(() => {
                                            releaseConnection(connection)
                                        })
                                    })
                            })
                            .catch((e) => {
                                console.log('Error:', e)
                                reject(e)
                                process.nextTick(() => {
                                    releaseConnection(connection)
                                })
                            })
                    })
                    .catch((e) => {
                        console.log('Error', e)
                        reject(e)
                    })
            })
        } else {
            // Executing without oracle pool
            return new Promise(async (resolve, reject) => {
                let connection
                try {
                    connection = oracledb.getConnection(dbConfig)
                    //console.log('NO POOL... Paging..')
                    let data = await executeQuery(sqlPaging, bindParams, options)

                    // Remove RNUM
                    data = data.map((d) => {
                        delete d['RNUM']
                        return d
                    })

                    let count = await executeScalar(sqlCount, bindParams, options)
                    paging.count = count

                    resolve({ data, paging })
                } catch (e) {
                    console.log(e)
                    reject(e)
                } finally {
                    ;(await connection).release()
                }
            })
        }
    } catch (e) {
        throw e
        //throw new Error(e)
    }
}
module.exports.executePaging = executePaging

// function createCondition(execObj = undefined) {
//     let condition = ''

//     if (execObj) {
//         if (execObj.params && execObj.params.length > 0) {
//             execObj.params.map((param) => {
//                 //console.log('Param: ', param)
//                 if (param.values.length === 1) {
//                     // One value
//                     condition += ` ${param.logic} ${param.columnName} ${param.operator} :${param.columnName} `
//                 } else {
//                     // // IN, between
//                     // if (param.operator.trim().toUpperCase() === 'BETWEEN') {
//                     //     condition += ` ${param.logic} ${param.columnName} ${param.operator} :${param.values[0]} and :${param.values[1]} `
//                     // } else if (param.operator.trim().toUpperCase() === 'IN') {
//                     //     let valueIn = ''
//                     //     param.values.map((value) => {
//                     //         if (value.length > 0) {
//                     //             value += ','
//                     //         }
//                     //         valueIn += value
//                     //     })
//                     //     condition += ` ${param.logic} ${param.columnName} ${param.operator} (${valueIn}) `
//                     // }
//                 }
//             })
//         }

//         //res.logger.debug("type of condition")
//         if (execObj.conditions && execObj.conditions.length > 0) {
//             execObj.conditions.map((c) => {
//                 condition += c
//             })
//         }
//     }

//     return condition
// }
// module.exports.createCondition = createCondition

// function createBindParams(execObj = undefined) {
//     let bindParams = []

//     if (execObj) {
//         if (execObj.bindParams && execObj.params.length > 0) {
//             execObj.params.map((param) => {
//                 if (param.values.length === 1) {
//                     condition += ` ${param.logic} ${param.columnName} ${param.operator} ${param.values[0]} `
//                 } else {
//                     // IN, between
//                     if (param.operator.trim().toUpperCase() === 'BETWEEN') {
//                         condition += ` ${param.logic} ${param.columnName} ${param.operator} ${param.values[0]} and ${param.values[1]} `
//                     } else if (param.operator.trim().toUpperCase() === 'IN') {
//                         let valueIn = ''
//                         param.values.map((value) => {
//                             if (value.length > 0) {
//                                 value += ','
//                             }
//                             valueIn += value
//                         })
//                         condition += ` ${param.logic} ${param.columnName} ${param.operator} (${valueIn}) `
//                     }
//                 }
//             })
//         }

//         //res.logger.debug("type of condition")
//         if (execObj.conditions && execObj.conditions.length > 0) {
//             execObj.conditions.map((c) => {
//                 condition += c
//             })
//         }
//     }

//     return bindParams
// }
// module.exports.createBindParams = createBindParams
